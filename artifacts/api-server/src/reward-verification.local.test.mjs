import assert from "node:assert/strict";
import { createServer } from "node:http";
import test, { after } from "node:test";
import {
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  parseAbi,
  parseAbiItem,
} from "viem";

const contractAddress = "0x000000000000000000000000000000000000cafe";
const projectWallet = "0x0000000000000000000000000000000000001001";
const creatorWallet = "0x0000000000000000000000000000000000002002";
const identityRegistry = "0x0000000000000000000000000000000000003003";
const celoToken = "0x471EcE3750Da237f93B8E339c536989b8978a438";
const gdollarToken = "0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A";
const swapRouter02 = "0x5615CDAb10dc425a742d643d949a7F474C01abc4";
const quoterV2 = "0x82825d0554fA07f7FC52Ab63c961F330fdEFa8E8";
const campaignId = 7n;
const celoFunded = 2_000_000_000_000_000_000n;
const gdPool = 1_000_000n;
const deadline = 2_000_000_000n;
const merkleRoot = `0x${"ab".repeat(32)}`;
const blockNumber = 100n;
const blockTimestamp = 1_900_000_000n;
const zeroRoot = `0x${"00".repeat(32)}`;
let scenario;
after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));

process.env.REWARD_POOL_CONTRACT_ADDRESS = contractAddress;

function rpcResult(method, params) {
  if (method === "eth_chainId") return "0xa4ec";
  if (method === "eth_getCode") return "0x60006000";
  if (method === "eth_getTransactionByHash") return scenario.transaction;
  if (method === "eth_getTransactionReceipt") return scenario.receipt;
  if (method === "eth_getBlockByNumber") {
    return {
      number: `0x${blockNumber.toString(16)}`,
      hash: `0x${"11".repeat(32)}`,
      parentHash: `0x${"22".repeat(32)}`,
      nonce: "0x0000000000000000",
      sha3Uncles: `0x${"33".repeat(32)}`,
      logsBloom: `0x${"00".repeat(256)}`,
      transactionsRoot: `0x${"44".repeat(32)}`,
      stateRoot: `0x${"55".repeat(32)}`,
      receiptsRoot: `0x${"66".repeat(32)}`,
      miner: "0x0000000000000000000000000000000000000000",
      difficulty: "0x0",
      totalDifficulty: "0x0",
      extraData: "0x",
      size: "0x1",
      gasLimit: "0x1c9c380",
      gasUsed: "0x5208",
      timestamp: `0x${(scenario.blockTimestamp ?? blockTimestamp).toString(16)}`,
      transactions: [],
      uncles: [],
      mixHash: `0x${"77".repeat(32)}`,
      baseFeePerGas: "0x1",
    };
  }
  if (method === "eth_call") {
    const data = params[0].data.toLowerCase();
    if (data.startsWith("0x")) {
      const campaignSelector = encodeFunctionData({
        abi: parseAbi(["function campaigns(uint256) view returns (address,uint256,uint256,uint256,bytes32,bool,bool,bool,uint64)"]),
        functionName: "campaigns",
        args: [campaignId],
      }).slice(0, 10);
      const hasClaimedSelector = encodeFunctionData({
        abi: parseAbi(["function hasClaimed(uint256,address) view returns (bool)"]),
        functionName: "hasClaimed",
        args: [campaignId, creatorWallet],
      }).slice(0, 10);
      const getters = [
        ["CELO", [], "address", celoToken],
        ["GDOLLAR", [], "address", gdollarToken],
        ["swapRouter", [], "address", scenario.routerAddress ?? swapRouter02],
        ["gdPoolFee", [], "uint24", 3000],
        ["identityRegistry", [], "address", identityRegistry],
      ];
      for (const [functionName, args, outputType, value] of getters) {
        const getterAbi = parseAbi([
          functionName === "gdPoolFee"
            ? "function gdPoolFee() view returns (uint24)"
            : `function ${functionName}() view returns (${outputType})`,
        ]);
        const selector = encodeFunctionData({
          abi: getterAbi,
          functionName,
          args,
        }).slice(0, 10);
        if (data.startsWith(selector.toLowerCase())) {
          return encodeAbiParameters([{ type: outputType }], [value]);
        }
      }
      const whitelistAbi = parseAbi([
        "function isWhitelisted(address account) view returns (bool)",
      ]);
      const whitelistSelector = encodeFunctionData({
        abi: whitelistAbi,
        functionName: "isWhitelisted",
        args: ["0x0000000000000000000000000000000000000000"],
      }).slice(0, 10);
      if (
        params[0].to?.toLowerCase() === identityRegistry.toLowerCase() &&
        data.startsWith(whitelistSelector.toLowerCase())
      ) {
        return encodeAbiParameters([{ type: "bool" }], [false]);
      }
      if (data.startsWith(campaignSelector.toLowerCase())) {
        const state = scenario.campaignState;
        return encodeAbiParameters(
          [
            { type: "address" },
            { type: "uint256" },
            { type: "uint256" },
            { type: "uint256" },
            { type: "bytes32" },
            { type: "bool" },
            { type: "bool" },
            { type: "bool" },
            { type: "uint64" },
          ],
          state,
        );
      }
      if (data.startsWith(hasClaimedSelector.toLowerCase())) {
        return encodeAbiParameters([{ type: "bool" }], [scenario.hasClaimed ?? true]);
      }
    }
    throw new Error(`Unexpected eth_call: ${data}`);
  }
  throw new Error(`Unexpected JSON-RPC method: ${method}`);
}

const server = createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  const payload = JSON.parse(body);
  const respond = (item) => {
    try {
      return { jsonrpc: "2.0", id: item.id, result: rpcResult(item.method, item.params ?? []) };
    } catch (error) {
      return { jsonrpc: "2.0", id: item.id, error: { code: -32000, message: error.message } };
    }
  };
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(Array.isArray(payload) ? payload.map(respond) : respond(payload)));
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
process.env.REWARD_POOL_RPC_URL = `http://127.0.0.1:${port}`;
const { isRewardClaimed, isRewardPoolDeploymentReady, isRewardVerificationConfigured, verifyClaim, verifyFunding, verifyRefund, verifyRoot, verifySwap } =
  await import("./reward-verification.ts");

const verifierAbi = parseAbi([
  "function createCampaign(bool requireIdentity,uint64 claimWindowSeconds) payable returns (uint256 campaignId)",
  "function finalizeSwap(uint256 campaignId,uint256 minGdOut,uint64 quoteDeadline)",
  "function publishRoot(uint256 campaignId,bytes32 merkleRoot)",
  "function claim(uint256 campaignId,uint256 amount,bytes32[] proof)",
  "function withdrawUnclaimed(uint256 campaignId)",
  "event CampaignCreated(uint256 indexed campaignId,address indexed project,uint256 ethDeposited,bool requireIdentity)",
  "event Swapped(uint256 indexed campaignId,uint256 ethIn,uint256 gdOut)",
  "event RootPublished(uint256 indexed campaignId,bytes32 merkleRoot)",
  "event Claimed(uint256 indexed campaignId,address indexed creator,uint256 amount)",
  "event UnclaimedWithdrawn(uint256 indexed campaignId,uint256 amount)",
]);

function eventLog(eventSignature, indexedArgs, dataTypes, dataValues, hash) {
  const event = parseAbiItem(eventSignature);
  const topics = encodeEventTopics({
    abi: [event],
    eventName: event.name,
    args: indexedArgs,
  });
  return {
    address: contractAddress,
    topics,
    data: encodeAbiParameters(dataTypes, dataValues),
    blockNumber: `0x${blockNumber.toString(16)}`,
    transactionHash: hash,
    transactionIndex: "0x0",
    blockHash: `0x${"11".repeat(32)}`,
    logIndex: "0x0",
    removed: false,
  };
}

function prepareTransaction({ hash, functionName, args, from = projectWallet, value = 0n, logs, status = "0x1", at = blockTimestamp }) {
  const input = encodeFunctionData({ abi: verifierAbi, functionName, args });
  const tx = {
    hash,
    nonce: "0x1",
    blockHash: `0x${"11".repeat(32)}`,
    blockNumber: `0x${blockNumber.toString(16)}`,
    transactionIndex: "0x0",
    from,
    to: contractAddress,
    value: `0x${value.toString(16)}`,
    gas: "0x5208",
    gasPrice: "0x1",
    input,
    v: "0x1",
    r: `0x${"01".repeat(32)}`,
    s: `0x${"02".repeat(32)}`,
    type: "0x0",
  };
  scenario = {
    transaction: tx,
    receipt: {
      transactionHash: hash,
      transactionIndex: "0x0",
      blockHash: tx.blockHash,
      blockNumber: tx.blockNumber,
      from,
      to: contractAddress,
      cumulativeGasUsed: "0x5208",
      gasUsed: "0x5208",
      contractAddress: null,
      logs,
      logsBloom: `0x${"00".repeat(256)}`,
      status,
      effectiveGasPrice: "0x1",
      type: "0x0",
    },
    blockTimestamp: at,
  };
  return hash;
}

function campaignState({
  pool = 0n,
  claimed = 0n,
  root = zeroRoot,
  identity = true,
  swapped = false,
  finalized = false,
  claimDeadline = 0n,
} = {}) {
  scenario.campaignState = [
    projectWallet,
    celoFunded,
    pool,
    claimed,
    root,
    identity,
    swapped,
    finalized,
    claimDeadline,
  ];
}

function txHash(id) {
  return `0x${id.toString(16).padStart(64, "0")}`;
}

test("local JSON-RPC lifecycle verifies funding, swap, root, identity claim, and expiry refund", async (t) => {
  assert.equal(isRewardVerificationConfigured(), true);
  scenario = {};
  assert.equal(await isRewardPoolDeploymentReady(), true);
  scenario.routerAddress = creatorWallet;
  assert.equal(await isRewardPoolDeploymentReady(), false);
  delete scenario.routerAddress;

  const fundingHash = txHash(1);
  const fundingLog = eventLog(
    "event CampaignCreated(uint256 indexed campaignId,address indexed project,uint256 ethDeposited,bool requireIdentity)",
    { campaignId, project: projectWallet },
    [{ type: "uint256" }, { type: "bool" }],
    [celoFunded, true],
    fundingHash,
  );
  prepareTransaction({
    hash: fundingHash,
    functionName: "createCampaign",
    args: [true, 1_209_600n],
    value: celoFunded,
    logs: [fundingLog],
  });
  campaignState();
  await verifyFunding({
    txHash: fundingHash,
    contractAddress,
    projectWallet,
    onchainCampaignId: Number(campaignId),
    ethFundedRaw: celoFunded.toString(),
    requireIdentity: true,
  });

  const swapHash = txHash(2);
  const swapLog = eventLog(
    "event Swapped(uint256 indexed campaignId,uint256 ethIn,uint256 gdOut)",
    { campaignId },
    [{ type: "uint256" }, { type: "uint256" }],
    [celoFunded, gdPool],
    swapHash,
  );
  prepareTransaction({
    hash: swapHash,
    functionName: "finalizeSwap",
    args: [campaignId, 950_000n, blockTimestamp + 60n],
    logs: [swapLog],
  });
  campaignState({ pool: gdPool, swapped: true });
  await verifySwap({
    txHash: swapHash,
    contractAddress,
    projectWallet,
    onchainCampaignId: Number(campaignId),
    ethFundedRaw: celoFunded.toString(),
    gdPoolRaw: gdPool.toString(),
  });

  const rootHash = txHash(3);
  const rootLog = eventLog(
    "event RootPublished(uint256 indexed campaignId,bytes32 merkleRoot)",
    { campaignId },
    [{ type: "bytes32" }],
    [merkleRoot],
    rootHash,
  );
  prepareTransaction({
    hash: rootHash,
    functionName: "publishRoot",
    args: [campaignId, merkleRoot],
    logs: [rootLog],
  });
  campaignState({ pool: gdPool, root: merkleRoot, swapped: true, finalized: true, claimDeadline: deadline });
  assert.equal(
    (await verifyRoot({
      txHash: rootHash,
      contractAddress,
      projectWallet,
      onchainCampaignId: Number(campaignId),
      merkleRoot,
      gdPoolRaw: gdPool.toString(),
    })).getTime(),
    Number(deadline) * 1000,
  );

  const claimHash = txHash(4);
  const claimAmount = 600_000n;
  const claimLog = eventLog(
    "event Claimed(uint256 indexed campaignId,address indexed creator,uint256 amount)",
    { campaignId, creator: creatorWallet },
    [{ type: "uint256" }],
    [claimAmount],
    claimHash,
  );
  prepareTransaction({
    hash: claimHash,
    functionName: "claim",
    args: [campaignId, claimAmount, []],
    from: creatorWallet,
    logs: [claimLog],
  });
  campaignState({ pool: gdPool, claimed: claimAmount, root: merkleRoot, identity: true, swapped: true, finalized: true, claimDeadline: deadline });
  scenario.hasClaimed = true;
  assert.equal(await isRewardClaimed(Number(campaignId), creatorWallet), true);
  assert.deepEqual(
    await verifyClaim({
      txHash: claimHash,
      contractAddress,
      onchainCampaignId: Number(campaignId),
      walletAddress: creatorWallet,
      amountRaw: claimAmount.toString(),
      merkleRoot,
    }),
    { fullyClaimed: false },
  );
  campaignState({ pool: gdPool, claimed: claimAmount, root: merkleRoot, identity: false, swapped: true, finalized: true, claimDeadline: deadline });
  await assert.rejects(
    verifyClaim({
      txHash: claimHash,
      contractAddress,
      onchainCampaignId: Number(campaignId),
      walletAddress: creatorWallet,
      amountRaw: claimAmount.toString(),
      merkleRoot,
    }),
    /Onchain published root does not match/,
  );

  const refundHash = txHash(5);
  const refundLog = eventLog(
    "event UnclaimedWithdrawn(uint256 indexed campaignId,uint256 amount)",
    { campaignId },
    [{ type: "uint256" }],
    [gdPool - claimAmount],
    refundHash,
  );
  prepareTransaction({
    hash: refundHash,
    functionName: "withdrawUnclaimed",
    args: [campaignId],
    logs: [refundLog],
    at: deadline + 1n,
  });
  campaignState({ pool: gdPool, claimed: gdPool, root: merkleRoot, identity: true, swapped: true, finalized: true, claimDeadline: deadline });
  assert.equal(
    await verifyRefund({
      txHash: refundHash,
      contractAddress,
      projectWallet,
      onchainCampaignId: Number(campaignId),
      gdPoolRaw: gdPool.toString(),
    }),
    (gdPool - claimAmount).toString(),
  );
});

test("local JSON-RPC verification rejects failed and wrong-owner transactions", async (t) => {
  const hash = txHash(6);
  const log = eventLog(
    "event CampaignCreated(uint256 indexed campaignId,address indexed project,uint256 ethDeposited,bool requireIdentity)",
    { campaignId, project: projectWallet },
    [{ type: "uint256" }, { type: "bool" }],
    [celoFunded, true],
    hash,
  );
  prepareTransaction({
    hash,
    functionName: "createCampaign",
    args: [true, 1_209_600n],
    value: celoFunded,
    logs: [log],
    status: "0x0",
  });
  campaignState();
  await assert.rejects(
    verifyFunding({
      txHash: hash,
      contractAddress,
      projectWallet,
      onchainCampaignId: Number(campaignId),
      ethFundedRaw: celoFunded.toString(),
      requireIdentity: true,
    }),
    /Reward transaction failed/,
  );
  prepareTransaction({
    hash,
    functionName: "createCampaign",
    args: [true, 1_209_600n],
    from: creatorWallet,
    value: celoFunded,
    logs: [log],
  });
  await assert.rejects(
    verifyFunding({
      txHash: hash,
      contractAddress,
      projectWallet,
      onchainCampaignId: Number(campaignId),
      ethFundedRaw: celoFunded.toString(),
      requireIdentity: true,
    }),
    /Funding values do not match/,
  );
});