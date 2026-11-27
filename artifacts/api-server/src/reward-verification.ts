import {
  createPublicClient,
  decodeFunctionData,
  http,
  isAddress,
  parseAbi,
  parseEventLogs,
  type Address,
  type Hash,
  type TransactionReceipt,
} from "viem";
import { celo } from "viem/chains";
import {
  GDOLLAR_TOKEN_ADDRESS,
  REWARD_POOL_CHAIN_ID,
  REWARD_POOL_CONTRACT_ADDRESS,
} from "./reward-pool";
import {
  claimDeadlineFromChainTimestamp,
  isIdentityPolicyEnabled,
} from "./reward-guards";

const rewardPoolAbi = parseAbi([
  "function createCampaign(bool requireIdentity,uint64 claimWindowSeconds) payable returns (uint256 campaignId)",
  "function finalizeSwap(uint256 campaignId,uint256 minGdOut,uint64 quoteDeadline)",
  "function publishRoot(uint256 campaignId,bytes32 merkleRoot)",
  "function claim(uint256 campaignId,uint256 amount,bytes32[] proof)",
  "function withdrawUnclaimed(uint256 campaignId)",
  "function campaigns(uint256) view returns (address project,uint256 ethDeposited,uint256 gdPool,uint256 gdClaimed,bytes32 merkleRoot,bool requireIdentity,bool swapped,bool finalized,uint64 claimDeadline)",
  "function hasClaimed(uint256,address) view returns (bool)",
  "function CELO() view returns (address)",
  "function GDOLLAR() view returns (address)",
  "function swapRouter() view returns (address)",
  "function gdPoolFee() view returns (uint24)",
  "function identityRegistry() view returns (address)",
  "event CampaignCreated(uint256 indexed campaignId,address indexed project,uint256 ethDeposited,bool requireIdentity)",
  "event Swapped(uint256 indexed campaignId,uint256 ethIn,uint256 gdOut)",
  "event RootPublished(uint256 indexed campaignId,bytes32 merkleRoot)",
  "event Claimed(uint256 indexed campaignId,address indexed creator,uint256 amount)",
  "event UnclaimedWithdrawn(uint256 indexed campaignId,uint256 amount)",
]);
const CELO_TOKEN_ADDRESS = "0x471EcE3750Da237f93B8E339c536989b8978a438";
const CELO_SWAP_ROUTER02_ADDRESS = "0x5615CDAb10dc425a742d643d949a7F474C01abc4";
const CELO_QUOTER_V2_ADDRESS = "0x82825d0554fA07f7FC52Ab63c961F330fdEFa8E8";
const identityRegistryAbi = parseAbi([
  "function isWhitelisted(address account) view returns (bool)",
]);

type TxData = { txHash: string; contractAddress: string };

export function isRewardVerificationConfigured(): boolean {
  if (!REWARD_POOL_CONTRACT_ADDRESS || !isAddress(REWARD_POOL_CONTRACT_ADDRESS)) {
    return false;
  }
  try {
    const rpcUrl = process.env.REWARD_POOL_RPC_URL;
    if (!rpcUrl) return false;
    const parsedUrl = new URL(rpcUrl);
    return parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:";
  } catch {
    return false;
  }
}

export async function isRewardPoolDeploymentReady(): Promise<boolean> {
  if (!isRewardVerificationConfigured()) return false;
  try {
    const { client, contractAddress } = configuredClient();
    if (await client.getChainId() !== REWARD_POOL_CHAIN_ID) return false;
    const [poolCode, gdollarCode, routerCode, quoterCode, celoAddress, gdollarAddress, routerAddress, fee, identityRegistry] =
      await Promise.all([
        client.getBytecode({ address: contractAddress }),
        client.getBytecode({ address: GDOLLAR_TOKEN_ADDRESS as Address }),
        client.getBytecode({ address: CELO_SWAP_ROUTER02_ADDRESS as Address }),
        client.getBytecode({ address: CELO_QUOTER_V2_ADDRESS as Address }),
        client.readContract({ address: contractAddress, abi: rewardPoolAbi, functionName: "CELO" }),
        client.readContract({ address: contractAddress, abi: rewardPoolAbi, functionName: "GDOLLAR" }),
        client.readContract({ address: contractAddress, abi: rewardPoolAbi, functionName: "swapRouter" }),
        client.readContract({ address: contractAddress, abi: rewardPoolAbi, functionName: "gdPoolFee" }),
        client.readContract({ address: contractAddress, abi: rewardPoolAbi, functionName: "identityRegistry" }),
      ]);
    if (
      !poolCode ||
      poolCode === "0x" ||
      !gdollarCode ||
      gdollarCode === "0x" ||
      !routerCode ||
      routerCode === "0x" ||
      !quoterCode ||
      quoterCode === "0x" ||
      celoAddress.toLowerCase() !== CELO_TOKEN_ADDRESS.toLowerCase() ||
      gdollarAddress.toLowerCase() !== GDOLLAR_TOKEN_ADDRESS.toLowerCase() ||
      routerAddress.toLowerCase() !== CELO_SWAP_ROUTER02_ADDRESS.toLowerCase() ||
      fee === 0 ||
      !identityRegistry ||
      identityRegistry === "0x0000000000000000000000000000000000000000"
    ) {
      return false;
    }
    const identityCode = await client.getBytecode({ address: identityRegistry });
    if (!identityCode || identityCode === "0x") return false;
    await client.readContract({
      address: identityRegistry,
      abi: identityRegistryAbi,
      functionName: "isWhitelisted",
      args: ["0x0000000000000000000000000000000000000000"],
    });
    return true;
  } catch {
    return false;
  }
}

export async function isRewardClaimed(
  onchainCampaignId: number,
  walletAddress: string,
): Promise<boolean> {
  if (!isPositiveCampaignId(onchainCampaignId) || !isAddress(walletAddress)) {
    throw new Error("Invalid campaign or claim wallet");
  }
  if (!await isRewardPoolDeploymentReady()) {
    throw new Error("Reward pool deployment is not ready");
  }
  const { client, contractAddress } = configuredClient();
  return client.readContract({
    address: contractAddress,
    abi: rewardPoolAbi,
    functionName: "hasClaimed",
    args: [BigInt(onchainCampaignId), walletAddress],
  });
}

function isPositiveCampaignId(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function configuredClient() {
  const rpcUrl = process.env.REWARD_POOL_RPC_URL;
  const contractAddress = REWARD_POOL_CONTRACT_ADDRESS;
  if (!isRewardVerificationConfigured() || !rpcUrl || !contractAddress) {
    throw new Error("Reward verification is not configured");
  }
  return {
    client: createPublicClient({ chain: celo, transport: http(rpcUrl) }),
    contractAddress: contractAddress as Address,
  };
}

async function verifiedTransaction(input: TxData) {
  const { client, contractAddress } = configuredClient();
  if (
    !/^0x[a-fA-F0-9]{64}$/.test(input.txHash) ||
    !isAddress(input.contractAddress) ||
    input.contractAddress.toLowerCase() !== contractAddress.toLowerCase()
  ) {
    throw new Error("Invalid reward transaction");
  }
  if (await client.getChainId() !== REWARD_POOL_CHAIN_ID) {
    throw new Error("Reward RPC is connected to the wrong chain");
  }
  if (!await isRewardPoolDeploymentReady()) {
    throw new Error("Reward pool deployment or Celo swap path is not ready");
  }
  const hash = input.txHash as Hash;
  const receipt = await client.getTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("Reward transaction failed");
  const transaction = await client.getTransaction({ hash });
  if (!transaction.to || transaction.to.toLowerCase() !== contractAddress.toLowerCase()) {
    throw new Error("Transaction targets a different contract");
  }
  return { client, contractAddress, receipt, transaction };
}

function matchingEvents(
  receipt: TransactionReceipt,
  contractAddress: Address,
  eventName: "CampaignCreated" | "Swapped" | "RootPublished" | "Claimed" | "UnclaimedWithdrawn",
): Array<{ args: Record<string, unknown> }> {
  const logs = receipt.logs.filter(
    (log) => log.address.toLowerCase() === contractAddress.toLowerCase(),
  );
  return parseEventLogs({
    abi: rewardPoolAbi,
    logs,
    eventName,
    strict: true,
  }) as unknown as Array<{ args: Record<string, unknown> }>;
}

export async function verifyFunding(input: TxData & {
  projectWallet: string;
  onchainCampaignId: number;
  ethFundedRaw: string;
  requireIdentity: boolean;
}): Promise<void> {
  const { client, contractAddress, receipt, transaction } = await verifiedTransaction(input);
  const decoded = decodeFunctionData({ abi: rewardPoolAbi, data: transaction.input });
  if (
    decoded.functionName !== "createCampaign" ||
    !input.requireIdentity ||
    decoded.args[0] !== true ||
    !isAddress(input.projectWallet)
  ) {
    throw new Error("Invalid funding transaction");
  }
  const events = matchingEvents(receipt, contractAddress, "CampaignCreated");
  const event = events.find(
    (entry) => {
      const args = entry.args as {
        campaignId: bigint;
        project: Address;
        requireIdentity: boolean;
      };
      return args.campaignId === BigInt(input.onchainCampaignId) &&
        args.project.toLowerCase() === input.projectWallet.toLowerCase() &&
      args.requireIdentity === true;
    },
  );
  const eventArgs = event?.args as
    | { ethDeposited: bigint }
    | undefined;
  if (
    !event ||
    transaction.from.toLowerCase() !== input.projectWallet.toLowerCase() ||
    transaction.value.toString() !== input.ethFundedRaw ||
    eventArgs?.ethDeposited !== transaction.value
  ) {
    throw new Error("Funding values do not match the successful contract event");
  }
  const state = await client.readContract({
    address: contractAddress,
    abi: rewardPoolAbi,
    functionName: "campaigns",
    args: [BigInt(input.onchainCampaignId)],
  });
  if (
    !isIdentityPolicyEnabled(
      decoded.args[0],
      (event.args as { requireIdentity: boolean }).requireIdentity,
      state[5],
    )
  ) {
    throw new Error("Onchain campaign does not require identity verification");
  }
  if (state[0].toLowerCase() !== input.projectWallet.toLowerCase() ||
      state[1] !== transaction.value ||
      state[2] !== 0n ||
      state[4] !== `0x${"0".repeat(64)}` ||
      state[5] !== true ||
      state[6] ||
      state[7] ||
      state[8] !== 0n) {
    throw new Error("Onchain campaign state does not match funding");
  }
}

export async function verifySwap(input: TxData & {
  onchainCampaignId: number;
  ethFundedRaw: string;
  gdPoolRaw: string;
  projectWallet: string;
}): Promise<void> {
  const { client, contractAddress, receipt, transaction } = await verifiedTransaction(input);
  const decoded = decodeFunctionData({ abi: rewardPoolAbi, data: transaction.input });
  if (
    decoded.functionName !== "finalizeSwap" ||
    decoded.args[0] !== BigInt(input.onchainCampaignId) ||
    decoded.args[1] <= 0n ||
    !isAddress(input.projectWallet) ||
    transaction.from.toLowerCase() !== input.projectWallet.toLowerCase()
  ) {
    throw new Error("Invalid swap transaction");
  }
  const swapBlock = await client.getBlock({ blockNumber: receipt.blockNumber });
  if (
    decoded.args[2] < swapBlock.timestamp ||
    decoded.args[2] > swapBlock.timestamp + 60n
  ) {
    throw new Error("Swap quote deadline was stale or too far in the future");
  }
  const event = matchingEvents(receipt, contractAddress, "Swapped").find(
    (entry) =>
      (entry.args as { campaignId: bigint }).campaignId ===
      BigInt(input.onchainCampaignId),
  );
  const eventArgs = event?.args as
    | { ethIn: bigint; gdOut: bigint }
    | undefined;
  if (!event || eventArgs?.ethIn.toString() !== input.ethFundedRaw ||
      eventArgs?.gdOut.toString() !== input.gdPoolRaw ||
      eventArgs.gdOut < decoded.args[1]) {
    throw new Error("Swap values do not match the successful contract event");
  }
  const state = await client.readContract({
    address: contractAddress,
    abi: rewardPoolAbi,
    functionName: "campaigns",
    args: [BigInt(input.onchainCampaignId)],
  });
  if (
    !state[6] ||
    state[7] ||
    state[5] !== true ||
    state[8] !== 0n ||
    state[1].toString() !== input.ethFundedRaw ||
    state[2].toString() !== input.gdPoolRaw
  ) {
    throw new Error("Onchain campaign state does not match swap");
  }
}

export async function verifyRoot(input: TxData & {
  onchainCampaignId: number;
  merkleRoot: string;
  gdPoolRaw: string;
  projectWallet: string;
}): Promise<Date> {
  const { client, contractAddress, receipt, transaction } = await verifiedTransaction(input);
  const decoded = decodeFunctionData({ abi: rewardPoolAbi, data: transaction.input });
  if (
    decoded.functionName !== "publishRoot" ||
    decoded.args[0] !== BigInt(input.onchainCampaignId) ||
    decoded.args[1].toLowerCase() !== input.merkleRoot.toLowerCase() ||
    /^0x0{64}$/i.test(input.merkleRoot) ||
    !isAddress(input.projectWallet) ||
    transaction.from.toLowerCase() !== input.projectWallet.toLowerCase()
  ) {
    throw new Error("Invalid root transaction");
  }
  const event = matchingEvents(receipt, contractAddress, "RootPublished").find(
    (entry) =>
      (entry.args as { campaignId: bigint }).campaignId ===
      BigInt(input.onchainCampaignId),
  );
  const eventArgs = event?.args as { merkleRoot: Hash } | undefined;
  if (!event || eventArgs?.merkleRoot.toLowerCase() !== input.merkleRoot.toLowerCase()) {
    throw new Error("Root does not match the successful contract event");
  }
  const state = await client.readContract({
    address: contractAddress,
    abi: rewardPoolAbi,
    functionName: "campaigns",
    args: [BigInt(input.onchainCampaignId)],
  });
  if (
    !state[6] ||
    !state[7] ||
    state[5] !== true ||
    state[2].toString() !== input.gdPoolRaw ||
    state[4].toLowerCase() !== input.merkleRoot.toLowerCase()
  ) {
    throw new Error("Onchain campaign state does not match root");
  }
  return claimDeadlineFromChainTimestamp(state[8]);
}

export async function verifyClaim(input: TxData & {
  onchainCampaignId: number;
  walletAddress: string;
  amountRaw: string;
  merkleRoot: string;
}): Promise<{ fullyClaimed: boolean }> {
  const { client, contractAddress, receipt, transaction } = await verifiedTransaction(input);
  const decoded = decodeFunctionData({ abi: rewardPoolAbi, data: transaction.input });
  if (
    decoded.functionName !== "claim" ||
    decoded.args[0] !== BigInt(input.onchainCampaignId) ||
    decoded.args[1].toString() !== input.amountRaw ||
    !isAddress(input.walletAddress) ||
    transaction.from.toLowerCase() !== input.walletAddress.toLowerCase()
  ) {
    throw new Error("Invalid claim transaction");
  }
  const event = matchingEvents(receipt, contractAddress, "Claimed").find(
    (entry) => {
      const args = entry.args as {
        campaignId: bigint;
        creator: Address;
        amount: bigint;
      };
      return args.campaignId === BigInt(input.onchainCampaignId) &&
        args.creator.toLowerCase() === input.walletAddress.toLowerCase() &&
        args.amount.toString() === input.amountRaw;
    },
  );
  if (!event) throw new Error("Claim does not match the successful contract event");
  const campaignState = await client.readContract({
    address: contractAddress,
    abi: rewardPoolAbi,
    functionName: "campaigns",
    args: [BigInt(input.onchainCampaignId)],
  });
  if (
    !campaignState[6] ||
    !campaignState[7] ||
    !isIdentityPolicyEnabled(true, true, campaignState[5]) ||
    campaignState[4].toLowerCase() !== input.merkleRoot.toLowerCase()
  ) {
    throw new Error("Onchain published root does not match");
  }
  const claimed = await client.readContract({
    address: contractAddress,
    abi: rewardPoolAbi,
    functionName: "hasClaimed",
    args: [BigInt(input.onchainCampaignId), input.walletAddress as Address],
  });
  if (!claimed) throw new Error("Onchain claim state is not recorded");
  return { fullyClaimed: campaignState[3] === campaignState[2] };
}

export async function verifyRefund(input: TxData & {
  onchainCampaignId: number;
  projectWallet: string;
  gdPoolRaw: string;
}): Promise<string> {
  const { client, contractAddress, receipt, transaction } = await verifiedTransaction(input);
  const decoded = decodeFunctionData({ abi: rewardPoolAbi, data: transaction.input });
  if (
    decoded.functionName !== "withdrawUnclaimed" ||
    decoded.args[0] !== BigInt(input.onchainCampaignId) ||
    !isAddress(input.projectWallet) ||
    transaction.from.toLowerCase() !== input.projectWallet.toLowerCase()
  ) {
    throw new Error("Invalid unclaimed G$ withdrawal transaction");
  }
  const event = matchingEvents(receipt, contractAddress, "UnclaimedWithdrawn").find(
    (entry) =>
      (entry.args as { campaignId: bigint }).campaignId ===
      BigInt(input.onchainCampaignId),
  );
  const refundedRaw = (event?.args as { amount: bigint } | undefined)?.amount;
  if (!event || !refundedRaw || refundedRaw <= 0n || refundedRaw > BigInt(input.gdPoolRaw)) {
    throw new Error("Refund amount does not match the successful contract event");
  }
  const state = await client.readContract({
    address: contractAddress,
    abi: rewardPoolAbi,
    functionName: "campaigns",
    args: [BigInt(input.onchainCampaignId)],
  });
  if (
    state[0].toLowerCase() !== input.projectWallet.toLowerCase() ||
    state[2].toString() !== input.gdPoolRaw ||
    state[3] !== state[2] ||
    state[4] === `0x${"0".repeat(64)}` ||
    state[5] !== true ||
    !state[6] ||
    !state[7] ||
    state[8] === 0n
  ) {
    throw new Error("Onchain campaign state does not match the completed refund");
  }
  const refundBlock = await client.getBlock({ blockNumber: receipt.blockNumber });
  if (refundBlock.timestamp <= state[8]) {
    throw new Error("The refund transaction was mined before the claim window expired");
  }
  return refundedRaw.toString();
}