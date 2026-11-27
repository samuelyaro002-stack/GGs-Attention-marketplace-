import assert from "node:assert/strict";
import { createServer } from "node:http";
import test, { after } from "node:test";
import { encodeAbiParameters, encodeEventTopics, encodeFunctionData, keccak256, parseAbi } from "viem";
import {
  celoPoolAbi, celoConfig, verifyCeloFunding, verifyCeloRoot,
  verifyCeloClaim, verifyCeloRefund, celoClaimAvailable, CELO_TOKEN,
} from "./celo-reward-verification.ts";
import { buildRewardDistribution } from "./reward-pool.ts";

// Synthetic RPC receipts exercise the verifier only: this test never signs,
// deploys a contract, or contacts a public blockchain.
const address = "0x000000000000000000000000000000000000cafe";
const project = "0x0000000000000000000000000000000000001001";
const creator = "0x0000000000000000000000000000000000002002";
const protocol = "0x0000000000000000000000000000000000003003";
const id = 7n, gross = 1000n, fee = 100n, net = 900n, timestamp = 1900000000n;
const deadline = timestamp + 14n * 86400n;
const txHash = `0x${"aa".repeat(32)}`, blockHash = `0x${"bb".repeat(32)}`, root = `0x${"cc".repeat(32)}`;
const zeroRoot = `0x${"00".repeat(32)}`;
const q = n => `0x${n.toString(16)}`;
let scenario;
function reset() {
  process.env.CELO_REWARD_POOL_NETWORK = "sepolia";
  scenario = {
    chainId: 11142220, code: "0x60006000", token: CELO_TOKEN, protocol, feeBps: 1000n,
    owner: project, claimed: false, timestamp,
    state: [project, gross, fee, net, 0n, zeroRoot, false, false, deadline],
    transaction: {
      hash: txHash, blockHash, blockNumber: "0x64", transactionIndex: "0x0",
      from: project, to: address, value: "0x0", gas: "0x100000", gasPrice: "0x1", nonce: "0x0",
      input: encodeFunctionData({ abi: celoPoolAbi, functionName: "createCampaign", args: [gross, false, 14n * 86400n] }),
      v: "0x1b", r: `0x${"11".repeat(32)}`, s: `0x${"22".repeat(32)}`, type: "0x0",
    },
    receipt: {
      transactionHash: txHash, transactionIndex: "0x0", blockHash, blockNumber: "0x64",
      from: project, to: address, cumulativeGasUsed: "0x5208", gasUsed: "0x5208",
      contractAddress: null, logsBloom: `0x${"00".repeat(256)}`, status: "0x1", type: "0x0", effectiveGasPrice: "0x1", logs: [],
    },
  };
  scenario.receipt.logs = [
    log("CampaignCreated", { campaignId: id, project }, ["uint256", "uint256", "uint256", "bool"], [gross, fee, net, false]),
  ];
}
function log(eventName, args, types, values) {
  return {
    address, topics: encodeEventTopics({ abi: celoPoolAbi, eventName, args }),
    data: encodeAbiParameters(types.map(type => ({ type })), values), blockHash, blockNumber: "0x64",
    transactionHash: txHash, transactionIndex: "0x0", logIndex: "0x0", removed: false,
  };
}
const stateTypes = ["address", "uint256", "uint256", "uint256", "uint256", "bytes32", "bool", "bool", "uint64"];
function rpc(method, params) {
  if (method === "eth_chainId") return q(scenario.chainId);
  if (method === "eth_getCode") return scenario.code;
  if (method === "eth_getTransactionByHash") return scenario.transaction;
  if (method === "eth_getTransactionReceipt") return scenario.receipt;
  if (method === "eth_getBlockByHash" || method === "eth_getBlockByNumber") return {
    number: "0x64", hash: blockHash, parentHash: `0x${"12".repeat(32)}`,
    timestamp: q(scenario.timestamp), gasLimit: "0x100000", gasUsed: "0x5208",
    difficulty: "0x0", totalDifficulty: "0x0", size: "0x1", nonce: "0x0000000000000000",
    miner: project, extraData: "0x", transactions: [], uncles: [], baseFeePerGas: "0x1",
  };
  if (method === "eth_call") {
    const data = params[0].data;
    const functions = [
      ["CELO", [], "address", scenario.token],
      ["protocolWallet", [], "address", scenario.protocol],
      ["owner", [], "address", scenario.owner],
      ["PROTOCOL_FEE_BPS", [], "uint256", scenario.feeBps],
      ["hasClaimed", [id, creator], "bool", scenario.claimed],
    ];
    for (const [name, args, type, value] of functions) {
      if (data.slice(0, 10) === encodeFunctionData({ abi: celoPoolAbi, functionName: name, args }).slice(0, 10)) {
        return encodeAbiParameters([{ type }], [value]);
      }
    }
    if (data.slice(0, 10) === encodeFunctionData({ abi: celoPoolAbi, functionName: "campaigns", args: [id] }).slice(0, 10)) {
      return encodeAbiParameters(stateTypes.map(type => ({ type })), scenario.state);
    }
  }
  throw new Error(`Unexpected RPC ${method}`);
}
const server = createServer(async (req, res) => {
  let raw = ""; for await (const chunk of req) raw += chunk;
  const reply = item => {
    try { return { jsonrpc: "2.0", id: item.id, result: rpc(item.method, item.params) }; }
    catch (e) { return { jsonrpc: "2.0", id: item.id, error: { code: -32000, message: e.message } }; }
  };
  const input = JSON.parse(raw);
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(Array.isArray(input) ? input.map(reply) : reply(input)));
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
process.env.CELO_REWARD_POOL_NETWORK = "sepolia";
process.env.CELO_REWARD_POOL_RPC_URL = `http://127.0.0.1:${server.address().port}`;
process.env.CELO_REWARD_POOL_CONTRACT_ADDRESS = address;
process.env.CELO_REWARD_POOL_PROTOCOL_WALLET = protocol;
process.env.CELO_REWARD_POOL_OWNER_WALLET = project;
process.env.CELO_REWARD_POOL_RUNTIME_CODE_HASH = keccak256("0x60006000");
process.env.CELO_REWARD_POOL_APPROVED = "true";
after(() => new Promise(resolve => server.close(resolve)));

function campaign() {
  return {
    id: 1, rewardAsset: "CELO", chainId: 11142220, contractAddress: address,
    projectWallet: project, onchainCampaignId: Number(id), amountDepositedRaw: gross.toString(),
    celoPoolRaw: net.toString(), protocolFeeRaw: fee.toString(), gdPoolRaw: "0",
    requireIdentity: false, claimDeadline: new Date(Number(deadline) * 1000), merkleRoot: root,
    rewardStatus: "root-published",
  };
}
function rootTx() {
  scenario.transaction.input = encodeFunctionData({ abi: celoPoolAbi, functionName: "publishRoot", args: [id, root] });
  scenario.state[5] = root; scenario.state[7] = true;
  scenario.receipt.logs = [log("RootPublished", { campaignId: id }, ["bytes32"], [root])];
}
function claimTx() {
  rootTx(); scenario.transaction.from = creator; scenario.claimed = true; scenario.state[4] = net;
  scenario.transaction.input = encodeFunctionData({ abi: celoPoolAbi, functionName: "claim", args: [id, net, []] });
  scenario.receipt.logs = [log("Claimed", { campaignId: id, creator }, ["uint256"], [net])];
}

test("approved Sepolia deployment is ready, WETH remains disabled", async () => {
  reset(); const config = await celoConfig(); assert.equal(config.ready, true); assert.equal(config.wethEnabled, false);
});
test("mainnet selection uses its own profile and stays disabled until matching approval", async () => {
  const keys = [
    "CELO_REWARD_POOL_NETWORK", "CELO_REWARD_POOL_MAINNET_RPC_URL",
    "CELO_REWARD_POOL_MAINNET_CONTRACT_ADDRESS", "CELO_REWARD_POOL_MAINNET_PROTOCOL_WALLET",
    "CELO_REWARD_POOL_MAINNET_OWNER_WALLET", "CELO_REWARD_POOL_MAINNET_RUNTIME_CODE_HASH",
    "CELO_REWARD_POOL_MAINNET_APPROVED",
  ];
  const previous = new Map(keys.map(key => [key, process.env[key]]));
  try {
    reset();
    process.env.CELO_REWARD_POOL_NETWORK = "mainnet";
    process.env.CELO_REWARD_POOL_MAINNET_RPC_URL = `http://127.0.0.1:${server.address().port}`;
    process.env.CELO_REWARD_POOL_MAINNET_CONTRACT_ADDRESS = address;
    process.env.CELO_REWARD_POOL_MAINNET_PROTOCOL_WALLET = protocol;
    process.env.CELO_REWARD_POOL_MAINNET_OWNER_WALLET = project;
    process.env.CELO_REWARD_POOL_MAINNET_RUNTIME_CODE_HASH = keccak256("0x60006000");
    process.env.CELO_REWARD_POOL_MAINNET_APPROVED = "false";
    let config = await celoConfig();
    assert.equal(config.network, "mainnet");
    assert.equal(config.chainId, 42220);
    assert.equal(config.tokenAddress, CELO_TOKEN);
    assert.equal(config.explorerUrl, "https://celoscan.io");
    assert.equal(config.ready, false);
    await assert.rejects(verifyCeloFunding(txHash, 7));

    process.env.CELO_REWARD_POOL_MAINNET_APPROVED = "true";
    config = await celoConfig();
    assert.equal(config.ready, false, "a Sepolia RPC response cannot approve a mainnet deployment");
    scenario.chainId = 42220;
    config = await celoConfig();
    assert.equal(config.ready, true);
    assert.equal(config.sourceVerificationUrl, `https://celoscan.io/address/${address}?tab=contract`);
    assert.equal((await verifyCeloFunding(txHash, 7)).chainId, 42220);
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    reset();
  }
});
test("funding disabled without explicit approval", async () => {
  reset(); process.env.CELO_REWARD_POOL_APPROVED = "false";
  try { assert.equal((await celoConfig()).ready, false); await assert.rejects(verifyCeloFunding(txHash, 7)); }
  finally { process.env.CELO_REWARD_POOL_APPROVED = "true"; }
});
test("reject mainnet, wrong token, fee recipient, owner, bytecode and fee rate", async () => {
  for (const change of [{ chainId: 42220 }, { token: creator }, { protocol: creator }, { owner: creator }, { code: "0x60016000" }, { feeBps: 999n }]) {
    reset(); Object.assign(scenario, change); assert.equal((await celoConfig()).ready, false);
  }
});
test("direct CELO settlement derives net pool and creation-time deadline", async () => {
  reset(); const saved = await verifyCeloFunding(txHash, 7);
  assert.equal(saved.celoPoolRaw, "900"); assert.equal(saved.protocolFeeRaw, "100");
  assert.equal(saved.amountDepositedRaw, "1000"); assert.equal(saved.claimDeadline.getTime(), Number(deadline) * 1000);
  assert.equal(saved.requireIdentity, false); assert.equal(saved.chainId, 11142220);
});
test("reject the obsolete funding-token selector and native CELO value", async () => {
  reset(); scenario.transaction.input = encodeFunctionData({
    abi: parseAbi(["function createCampaign(address,uint256,bool,uint64)"]),
    functionName: "createCampaign", args: [CELO_TOKEN, gross, false, 14n * 86400n],
  });
  await assert.rejects(verifyCeloFunding(txHash, 7));
  reset(); scenario.transaction.value = "0x1"; await assert.rejects(verifyCeloFunding(txHash, 7), /native value/);
});
test("reject failed, wrong-target and unconfirmed transactions", async () => {
  reset(); scenario.receipt.status = "0x0"; await assert.rejects(verifyCeloFunding(txHash, 7));
  reset(); scenario.transaction.to = creator; await assert.rejects(verifyCeloFunding(txHash, 7));
  reset(); scenario.transaction.blockHash = zeroRoot; await assert.rejects(verifyCeloFunding(txHash, 7), /confirmed/);
});
test("reject spoofed creation emitter and wrong onchain campaign id", async () => {
  reset(); scenario.receipt.logs[0].address = creator; await assert.rejects(verifyCeloFunding(txHash, 7), /creation/);
  reset(); await assert.rejects(verifyCeloFunding(txHash, 8), /creation/);
});
test("reject altered settlement amount and deadline", async () => {
  reset(); scenario.state[3] = gross; await assert.rejects(verifyCeloFunding(txHash, 7), /settled/);
  reset(); scenario.state[8] += 1n; await assert.rejects(verifyCeloFunding(txHash, 7), /settled/);
});
test("reject fee or net pool mismatches in the new creation event", async () => {
  reset(); scenario.receipt.logs[0] = log("CampaignCreated", { campaignId: id, project },
    ["uint256", "uint256", "uint256", "bool"], [gross, 99n, net, false]);
  await assert.rejects(verifyCeloFunding(txHash, 7), /creation/);
});
test("funding policy rejects identity and different claim windows", async () => {
  for (const args of [[gross, true, 14n * 86400n], [gross, false, 7n * 86400n]]) {
    reset(); scenario.transaction.input = encodeFunctionData({ abi: celoPoolAbi, functionName: "createCampaign", args });
    await assert.rejects(verifyCeloFunding(txHash, 7), /policy/);
  }
});
test("stored protocol fee must match the pure-CELO tuple", async () => {
  reset(); rootTx();
  await assert.rejects(verifyCeloRoot({ ...campaign(), protocolFeeRaw: "99" }, txHash, root), /state/);
});
test("root is project-only even when contract ownership differs", async () => {
  reset(); rootTx(); scenario.owner = creator;
  process.env.CELO_REWARD_POOL_OWNER_WALLET = creator;
  try {
    await verifyCeloRoot(campaign(), txHash, root);
    scenario.transaction.from = creator;
    await assert.rejects(verifyCeloRoot(campaign(), txHash, root), /mismatch/);
  } finally { process.env.CELO_REWARD_POOL_OWNER_WALLET = project; }
});
test("root verifies owner, calldata, event and CELO tuple indexes", async () => {
  reset(); rootTx(); await verifyCeloRoot(campaign(), txHash, root);
  scenario.transaction.from = creator; await assert.rejects(verifyCeloRoot(campaign(), txHash, root), /mismatch/);
});
test("cannot record a root published after the creation-time deadline", async () => {
  reset(); rootTx(); scenario.timestamp = deadline + 1n; await assert.rejects(verifyCeloRoot(campaign(), txHash, root), /expired/);
});
test("claim verifies sender, amount and proof", async () => {
  reset(); claimTx();
  const input = { txHash, walletAddress: creator, amountRaw: net.toString() };
  await verifyCeloClaim(campaign(), input, []);
  await assert.rejects(verifyCeloClaim(campaign(), { ...input, amountRaw: "899" }, []), /mismatch/);
  await assert.rejects(verifyCeloClaim(campaign(), { ...input, walletAddress: project }, []), /mismatch/);
  await assert.rejects(verifyCeloClaim(campaign(), input, [root]), /mismatch/);
});
test("legacy campaign cannot use CELO verification", async () => {
  reset(); rootTx(); await assert.rejects(verifyCeloRoot({ ...campaign(), rewardAsset: "G$", chainId: 11142220 }, txHash, root), /bound/);
});
test("unclaimed lookup fails after claim or expiry", async () => {
  reset(); rootTx(); assert.equal(await celoClaimAvailable(campaign(), creator), true);
  scenario.claimed = true; assert.equal(await celoClaimAvailable(campaign(), creator), false);
  scenario.claimed = false; scenario.timestamp = deadline + 1n; assert.equal(await celoClaimAvailable(campaign(), creator), false);
});
test("refund works after expiry without a published root; rejects early refunds", async () => {
  reset(); scenario.timestamp = deadline + 1n; scenario.state[4] = net;
  scenario.transaction.input = encodeFunctionData({ abi: celoPoolAbi, functionName: "withdrawUnclaimed", args: [id] });
  scenario.receipt.logs = [log("UnclaimedWithdrawn", { campaignId: id }, ["uint256"], [net])];
  await verifyCeloRefund({ ...campaign(), merkleRoot: null, rewardStatus: "funded" }, txHash);
  scenario.timestamp = deadline; await assert.rejects(verifyCeloRefund(campaign(), txHash), /not expired/);
});
test("XP allocation uses only the 90% net pool and conserves rounding", () => {
  const tree = buildRewardDistribution(7, "901", [
    { walletAddress: creator, handle: "first", xp: 1 },
    { walletAddress: project, handle: "second", xp: 2 },
  ]);
  assert.equal(tree.totalAllocatedRaw, "901");
  assert.equal(tree.leaves.reduce((sum, leaf) => sum + BigInt(leaf.amountRaw), 0n), 901n);
});