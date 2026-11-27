import assert from "node:assert/strict";
import { createServer } from "node:http";
import test, { after } from "node:test";
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, encodeFunctionData, keccak256 } from "viem";
import { celoRewardPoolAbi as abi, CELO_DEPLOYMENT } from "@workspace/celo-contract";

// RPC doubles only; this suite never signs or sends a blockchain transaction.
const address = CELO_DEPLOYMENT.contractAddress, owner = CELO_DEPLOYMENT.ownerWallet;
const project = "0x0000000000000000000000000000000000001001";
const a = "0x0000000000000000000000000000000000002002";
const b = "0x0000000000000000000000000000000000003003";
const id = 7n, time = 1900000000n, window = 14n * 86400n, deadline = time + window;
const txHash = `0x${"aa".repeat(32)}`, blockHash = `0x${"bb".repeat(32)}`;
const quantity = value => `0x${value.toString(16)}`;
let state, sender, calldata, logs, paid, native, receiptStatus, rpcChainId;
function event(eventName, args, types, values, index = 0) {
  return { address, topics: encodeEventTopics({ abi, eventName, args }),
    data: encodeAbiParameters(types.map(type => ({ type })), values),
    blockHash, blockNumber: "0x64", transactionHash: txHash,
    transactionIndex: "0x0", logIndex: quantity(index), removed: false };
}
function reset() {
  process.env.CELO_REWARD_POOL_NETWORK = "sepolia";
  rpcChainId = 11142220n;
  state = [project, 1000n, 100n, 900n, 0n, false, deadline];
  paid = new Set(); sender = project; native = "0x0"; receiptStatus = "0x1";
  calldata = encodeFunctionData({ abi, functionName: "createCampaign", args: [1000n, false, window] });
  logs = [event("CampaignCreated", { campaignId: id, project },
    ["uint256", "uint256", "uint256", "bool"], [1000n, 100n, 900n, false])];
}
function payout() {
  sender = owner; state[4] = 900n; paid = new Set([a.toLowerCase(), b.toLowerCase()]);
  calldata = encodeFunctionData({ abi, functionName: "distributeBatch", args: [id, [a, b], [300n, 600n]] });
  logs = [event("Distributed", { campaignId: id, creator: a }, ["uint256"], [300n]),
    event("Distributed", { campaignId: id, creator: b }, ["uint256"], [600n], 1)];
}
function rpc(method, params) {
  if (method === "eth_chainId") return quantity(rpcChainId);
  if (method === "eth_getCode") return "0x60006000";
  if (method === "eth_call") {
    const decoded = decodeFunctionData({ abi, data: params[0].data });
    const { functionName: name, args } = decoded;
    const views = { CELO: CELO_DEPLOYMENT.tokenAddress, owner,
      protocolWallet: CELO_DEPLOYMENT.protocolWallet };
    if (views[name]) return encodeAbiParameters([{ type: "address" }], [views[name]]);
    if (name === "PROTOCOL_FEE_BPS") return encodeAbiParameters([{ type: "uint256" }], [1000n]);
    if (name === "campaigns") return encodeAbiParameters(
      ["address", "uint256", "uint256", "uint256", "uint256", "bool", "uint64"].map(type => ({ type })), state);
    if (name === "hasBeenPaid") return encodeAbiParameters([{ type: "bool" }], [paid.has(args[1].toLowerCase())]);
  }
  if (method === "eth_getTransactionByHash") return {
    hash: txHash, blockHash, blockNumber: "0x64", transactionIndex: "0x0",
    from: sender, to: address, value: native, input: calldata, gas: "0x100000",
    gasPrice: "0x1", nonce: "0x0", v: "0x1b", r: txHash, s: txHash, type: "0x0",
  };
  if (method === "eth_getTransactionReceipt") return {
    transactionHash: txHash, blockHash, blockNumber: "0x64", transactionIndex: "0x0",
    from: sender, to: address, status: receiptStatus, logs, gasUsed: "0x5208",
    cumulativeGasUsed: "0x5208", effectiveGasPrice: "0x1", contractAddress: null,
    logsBloom: `0x${"00".repeat(256)}`, type: "0x0",
  };
  if (method === "eth_getBlockByHash" || method === "eth_getBlockByNumber") return {
    number: "0x64", hash: blockHash, parentHash: txHash, timestamp: quantity(time),
    gasLimit: "0x100000", gasUsed: "0x5208", difficulty: "0x0", totalDifficulty: "0x0",
    size: "0x1", nonce: "0x0000000000000000", miner: project, extraData: "0x",
    transactions: [], uncles: [], baseFeePerGas: "0x1",
  };
  throw new Error(`Unexpected RPC: ${method}`);
}
const server = createServer(async (req, res) => {
  let raw = ""; for await (const chunk of req) raw += chunk;
  const reply = item => {
    try { return { jsonrpc: "2.0", id: item.id, result: rpc(item.method, item.params) }; }
    catch (error) { return { jsonrpc: "2.0", id: item.id, error: { code: -32000, message: error.message } }; }
  };
  const input = JSON.parse(raw);
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(Array.isArray(input) ? input.map(reply) : reply(input)));
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
process.env.CELO_REWARD_POOL_NETWORK = "sepolia";
process.env.CELO_REWARD_POOL_RPC_URL = `http://127.0.0.1:${server.address().port}`;
process.env.CELO_REWARD_POOL_CONTRACT_ADDRESS = address;
process.env.CELO_REWARD_POOL_PROTOCOL_WALLET = CELO_DEPLOYMENT.protocolWallet;
process.env.CELO_REWARD_POOL_OWNER_WALLET = owner;
process.env.CELO_REWARD_POOL_RUNTIME_CODE_HASH = keccak256("0x60006000");
process.env.CELO_REWARD_POOL_APPROVED = "true";
const { xpAllocations, payoutPreview, verifyCeloFundingV3, verifyCeloPayout, hydrateCeloBalances, celoConfigV3 } = await import("./celo-payout.ts");
after(() => new Promise(resolve => server.close(resolve)));
const submissions = [
  { id: 1, walletAddress: a, xp: 1, handle: "@first" },
  { id: 2, walletAddress: b, xp: 2, handle: "@second" },
];
const campaign = () => ({ id: 1, name: "Synthetic campaign", rewardAsset: "CELO", chainId: 11142220,
  contractAddress: address, projectWallet: project, onchainCampaignId: 7, amountDepositedRaw: "1000",
  protocolFeeRaw: "100", celoPoolRaw: "900", requireIdentity: false, rewardStatus: "funded",
  claimDeadline: new Date(Number(deadline) * 1000), celoTargetAmount: "999999", merkleRoot: null });

test("v3 uses nonpayable batch distribution and removes root/self-claim selectors", () => {
  for (const name of ["createCampaign", "distributeBatch", "withdrawRemaining"])
    assert.equal(abi.find(item => item.name === name).stateMutability, "nonpayable");
  assert.equal(abi.some(item => ["publishRoot", "claim"].includes(item.name)), false);
});
test("v3 cannot enable wallet actions using an approved but stale contract address", async () => {
  reset(); process.env.CELO_REWARD_POOL_CONTRACT_ADDRESS = project;
  try { assert.equal((await celoConfigV3()).ready, false); }
  finally { process.env.CELO_REWARD_POOL_CONTRACT_ADDRESS = address; }
});
test("mainnet funding stays closed until the separately approved deployment matches chain state", async () => {
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
    process.env.CELO_REWARD_POOL_MAINNET_PROTOCOL_WALLET = CELO_DEPLOYMENT.protocolWallet;
    process.env.CELO_REWARD_POOL_MAINNET_OWNER_WALLET = owner;
    process.env.CELO_REWARD_POOL_MAINNET_RUNTIME_CODE_HASH = keccak256("0x60006000");
    process.env.CELO_REWARD_POOL_MAINNET_APPROVED = "false";
    let config = await celoConfigV3();
    assert.equal(config.network, "mainnet");
    assert.equal(config.chainId, 42220);
    assert.equal(config.ready, false);
    await assert.rejects(verifyCeloFundingV3(txHash, 7));

    process.env.CELO_REWARD_POOL_MAINNET_APPROVED = "true";
    assert.equal((await celoConfigV3()).ready, false, "the selected network RPC must report Celo Mainnet");
    rpcChainId = 42220n;
    config = await celoConfigV3();
    assert.equal(config.ready, true);
    assert.equal((await verifyCeloFundingV3(txHash, 7)).chainId, 42220);
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    reset();
  }
});
test("XP allocation groups wallets, uses bigint, and conserves indivisible rounding", () => {
  const result = xpAllocations(901n, [...submissions, { id: 3, walletAddress: a.toUpperCase().replace("0X", "0x"), xp: 1, handle: "@duplicate" }]);
  assert.equal(result.payouts.length, 2);
  assert.equal(result.totalXp, 4);
  assert.equal(result.payouts.reduce((sum, row) => sum + row.amount, 0n), 901n);
  assert.throws(() => xpAllocations(900n, [{ ...submissions[0], xp: 0 }]));
  assert.throws(() => xpAllocations(900n, [{ ...submissions[0], walletAddress: `0x${"0".repeat(40)}` }]));
  assert.throws(() => xpAllocations(1n, submissions), /too small/);
});
test("funding verifies the new seven-field tuple, creation event, fee and deadline", async () => {
  reset(); const saved = await verifyCeloFundingV3(txHash, 7);
  assert.equal(saved.celoPoolRaw, "900"); assert.equal(saved.protocolFeeRaw, "100");
  assert.equal(saved.amountDepositedRaw, "1000"); assert.equal(saved.claimDeadline.getTime(), Number(deadline) * 1000);
  native = "0x1"; await assert.rejects(verifyCeloFundingV3(txHash, 7));
  reset(); state[6] += 1n; await assert.rejects(verifyCeloFundingV3(txHash, 7), /differs/);
  reset(); receiptStatus = "0x0"; await assert.rejects(verifyCeloFundingV3(txHash, 7));
});
test("batch verification checks admin sender, XP amounts, emitted payouts and paid flags", async () => {
  reset(); payout(); await verifyCeloPayout(campaign(), submissions, txHash);
  sender = project; await assert.rejects(verifyCeloPayout(campaign(), submissions, txHash), /administrator/);
  reset(); payout(); paid.delete(b.toLowerCase());
  await assert.rejects(verifyCeloPayout(campaign(), submissions, txHash), /flag/);
  reset(); payout(); logs.pop(); await assert.rejects(verifyCeloPayout(campaign(), submissions, txHash), /events/);
  reset(); payout(); calldata = encodeFunctionData({ abi, functionName: "distributeBatch", args: [id, [a, b], [301n, 599n]] });
  await assert.rejects(verifyCeloPayout(campaign(), submissions, txHash), /XP shares/);
});
test("paid wallets are excluded and a fully paid campaign cannot be paid again", async () => {
  reset(); paid.add(a.toLowerCase()); state[4] = 300n;
  const partial = await payoutPreview(campaign(), submissions);
  assert.equal(partial.eligible, true); assert.deepEqual(partial.recipients, [b]);
  assert.deepEqual(partial.amounts, ["600"]); assert.equal(partial.remainingRaw, "600");
  payout(); const full = await payoutPreview(campaign(), submissions);
  assert.equal(full.eligible, false); assert.deepEqual(full.recipients, []);
  assert.ok(full.submissions.every(row => row.paid));
});
test("allocation/accounting mismatch blocks distribution, rather than guessing", async () => {
  reset(); paid.add(a.toLowerCase()); state[4] = 200n;
  const result = await payoutPreview(campaign(), submissions);
  assert.equal(result.eligible, false); assert.deepEqual(result.amounts, []);
  assert.match(result.reason, /do not match/);
});
test("historical network balances remain readable but cannot produce a payout batch", async () => {
  reset();
  process.env.CELO_REWARD_POOL_NETWORK = "mainnet";
  try {
    const result = await payoutPreview(campaign(), submissions);
    assert.equal(result.poolRaw, "900");
    assert.equal(result.eligible, false);
    assert.deepEqual(result.recipients, []);
    assert.deepEqual(result.amounts, []);
    assert.match(result.reason, /different Celo network/);
  } finally {
    reset();
  }
});
test("campaign board reads remaining CELO from the contract, never target intent", async () => {
  reset(); state[4] = 450n; const live = await hydrateCeloBalances(campaign());
  assert.equal(live.amountDepositedRaw, "1000"); assert.equal(live.celoRemainingRaw, "450");
  assert.equal(live.celoDistributedRaw, "450"); assert.equal(live.celoTargetAmount, "999999");
});
test("per-submission display does not duplicate an aggregated wallet payout", async () => {
  reset(); const rows = [...submissions, { id: 3, walletAddress: a, xp: 1, handle: "@duplicate" }];
  const result = await payoutPreview(campaign(), rows);
  assert.equal(result.submissions.reduce((sum, row) => sum + BigInt(row.payoutRaw), 0n), 900n);
  assert.equal(result.recipients.length, 2);
});
