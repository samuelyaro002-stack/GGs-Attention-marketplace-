import {
  createPublicClient, decodeFunctionData, http, isAddress, keccak256, parseEventLogs,
  zeroAddress, type Address, type Hash,
} from "viem";
import { celo, celoSepolia } from "viem/chains";
import type { Campaign } from "@workspace/db";
import { legacyCeloRewardPoolAbi as celoRewardPoolAbi, CELO_DEPLOYMENT } from "@workspace/celo-contract";

export const CELO_TOKEN = "0x471EcE3750Da237f93B8E339c536989b8978a438" as Address;
export const celoPoolAbi = celoRewardPoolAbi;

const CELO_NETWORKS = {
  sepolia: { id: "sepolia", chain: celoSepolia, name: "Celo Sepolia", tokenAddress: CELO_TOKEN },
  mainnet: { id: "mainnet", chain: celo, name: "Celo Mainnet", tokenAddress: CELO_TOKEN },
} as const;
export type CeloNetworkId = keyof typeof CELO_NETWORKS;
export const CELO_CHAIN_ID = CELO_NETWORKS.sepolia.chain.id;

export class CeloVerificationError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new CeloVerificationError(message);
}
const same = (a: string | null, b: string | null) =>
  Boolean(a && b && a.toLowerCase() === b.toLowerCase());
export function selectedCeloNetworkId(): CeloNetworkId {
  const selected = process.env.CELO_REWARD_POOL_NETWORK ?? "sepolia";
  if (selected !== "sepolia" && selected !== "mainnet") {
    throw new CeloVerificationError("CELO_REWARD_POOL_NETWORK must be sepolia or mainnet.", 503);
  }
  return selected;
}
export function selectedCeloChainId() {
  return CELO_NETWORKS[selectedCeloNetworkId()].chain.id;
}
export function celoNetworkIdForChainId(chainId: number): CeloNetworkId | null {
  if (chainId === CELO_NETWORKS.sepolia.chain.id) return "sepolia";
  if (chainId === CELO_NETWORKS.mainnet.chain.id) return "mainnet";
  return null;
}
function settings(networkId = selectedCeloNetworkId()) {
  const network = CELO_NETWORKS[networkId];
  const tokenAddress = network.tokenAddress;
  const prefix = networkId === "mainnet" ? "CELO_REWARD_POOL_MAINNET" : "CELO_REWARD_POOL";
  const address = process.env[`${prefix}_CONTRACT_ADDRESS`] ?? "";
  const protocolWallet = process.env[`${prefix}_PROTOCOL_WALLET`] ?? "";
  const ownerWallet = process.env[`${prefix}_OWNER_WALLET`] ?? "";
  const runtimeCodeHash = process.env[`${prefix}_RUNTIME_CODE_HASH`] ?? "";
  const approved = process.env[`${prefix}_APPROVED`] === "true";
  const rpcUrl = networkId === "mainnet"
    ? process.env.CELO_REWARD_POOL_MAINNET_RPC_URL ?? network.chain.rpcUrls.default.http[0]
    : process.env.CELO_REWARD_POOL_SEPOLIA_RPC_URL ??
      process.env.CELO_REWARD_POOL_RPC_URL ?? network.chain.rpcUrls.default.http[0];
  return {
    network,
    tokenAddress,
    rpcUrl,
    address: isAddress(address) && address !== zeroAddress ? address as Address : null,
    protocolWallet: isAddress(protocolWallet) && protocolWallet !== zeroAddress ? protocolWallet as Address : null,
    ownerWallet: isAddress(ownerWallet) && ownerWallet !== zeroAddress ? ownerWallet as Address : null,
    runtimeCodeHash,
    approved,
    client: createPublicClient({
      chain: network.chain,
      transport: http(rpcUrl, { timeout: 10_000, retryCount: 0 }),
    }),
  };
}

export async function celoConfigForNetwork(networkId: CeloNetworkId) {
  const { network, rpcUrl, tokenAddress, address, protocolWallet, ownerWallet, runtimeCodeHash, approved, client } = settings(networkId);
  const explorerUrl = network.chain.blockExplorers.default.url.replace(/\/$/, "");
  let reason: string | null = `${network.name} deployment and protocol fee wallet have not been verified and approved.`;
  if (address && protocolWallet && ownerWallet && /^0x[a-fA-F0-9]{64}$/.test(runtimeCodeHash) && approved) {
    try {
      const [actualChainId, code, tokenCode, token, wallet, owner, fee] = await Promise.all([
        client.getChainId(),
        client.getBytecode({ address }),
        client.getBytecode({ address: tokenAddress }),
        client.readContract({ address, abi: celoPoolAbi, functionName: "CELO" }),
        client.readContract({ address, abi: celoPoolAbi, functionName: "protocolWallet" }),
        client.readContract({ address, abi: celoPoolAbi, functionName: "owner" }),
        client.readContract({ address, abi: celoPoolAbi, functionName: "PROTOCOL_FEE_BPS" }),
      ]);
      if (actualChainId === network.chain.id && code && code !== "0x" && tokenCode && tokenCode !== "0x" &&
          same(keccak256(code), runtimeCodeHash) && same(token, tokenAddress) &&
          same(wallet, protocolWallet) && same(owner, ownerWallet) && fee === 1000n) reason = null;
      else reason = `${network.name} bytecode, token, fee, protocol wallet or contract owner does not match the approved configuration.`;
    } catch { reason = `Unable to verify the approved ${network.name} deployment. No wallet action is available.`; }
  }
  return {
    network: network.id,
    chainId: network.chain.id,
    chainName: network.name,
    rpcUrl,
    explorerUrl,
    tokenAddress,
    contractAddress: address,
    protocolWallet,
    ownerWallet,
    runtimeCodeHash: /^0x[a-fA-F0-9]{64}$/.test(runtimeCodeHash) ? runtimeCodeHash : null,
    sourceVerificationUrl: address
      ? `${explorerUrl}/address/${address}?tab=contract`
      : networkId === "sepolia" ? CELO_DEPLOYMENT.sourceVerificationUrl : explorerUrl,
    ready: reason === null, reason, wethEnabled: false as const, protocolFeeBps: 1000 as const,
  };
}

export async function celoConfig() {
  return celoConfigForNetwork(selectedCeloNetworkId());
}

export function celoPublicClientForNetwork(networkId: CeloNetworkId) {
  return settings(networkId).client;
}

export async function readyCeloClient(campaign?: Campaign) {
  const networkId = campaign ? celoNetworkIdForChainId(campaign.chainId) : selectedCeloNetworkId();
  if (!networkId) throw new CeloVerificationError("Campaign uses an unsupported Celo network.", 409);
  const config = await celoConfigForNetwork(networkId);
  if (!config.ready || !config.contractAddress) throw new CeloVerificationError(config.reason ?? "CELO unavailable", 503);
  if (campaign) check(
    campaign.rewardAsset === "CELO" && campaign.chainId === config.chainId &&
    same(campaign.contractAddress, config.contractAddress) && campaign.onchainCampaignId !== null,
    `Campaign is not bound to the approved ${config.chainName} contract`,
  );
  return { client: celoPublicClientForNetwork(networkId), address: config.contractAddress as Address };
}

async function verifiedTx(txHash: string, campaign?: Campaign) {
  check(/^0x[a-fA-F0-9]{64}$/.test(txHash), "Invalid transaction hash");
  const { client, address } = await readyCeloClient(campaign);
  const [receipt, tx] = await Promise.all([
    client.getTransactionReceipt({ hash: txHash as Hash }),
    client.getTransaction({ hash: txHash as Hash }),
  ]);
  check(receipt.status === "success" && same(tx.to, address) && tx.value === 0n,
    "Transaction failed, sent native value, or targeted another contract");
  check(tx.blockHash === receipt.blockHash, "Transaction is not confirmed in the receipt block");
  const block = await client.getBlock({ blockHash: receipt.blockHash });
  const decoded = decodeFunctionData({ abi: celoPoolAbi, data: tx.input });
  const events = parseEventLogs({
    abi: celoPoolAbi,
    logs: receipt.logs.filter(log => same(log.address, address)),
    strict: true,
  });
  return { client, address, receipt, tx, block, decoded, events };
}
type State = readonly [Address, bigint, bigint, bigint, bigint, Hash, boolean, boolean, bigint];

function boundState(state: State, campaign: Campaign) {
  check(same(state[0], campaign.projectWallet) &&
    state[1].toString() === campaign.amountDepositedRaw &&
    state[2].toString() === campaign.protocolFeeRaw && state[3].toString() === campaign.celoPoolRaw &&
    !state[6] && !campaign.requireIdentity &&
    Number(state[8]) * 1000 === campaign.claimDeadline?.getTime(),
    "Onchain CELO state does not match the campaign");
}

export async function verifyCeloFunding(txHash: string, id: number) {
  check(Number.isSafeInteger(id) && id >= 0 && id <= 2147483647, "Invalid onchain campaign id");
  const networkId = selectedCeloNetworkId();
  const { client, address, receipt, tx, block, decoded, events } = await verifiedTx(txHash);
  check(decoded.functionName === "createCampaign", "Not a CELO campaign funding transaction");
  const [amount, identity, window] = decoded.args;
  check(amount > 0n && identity === false && window === 14n * 86400n,
    "Only pure-CELO funding with the selected network policy is enabled");
  const fee = amount * 1000n / 10000n;
  const created = events.find(e => e.eventName === "CampaignCreated" && e.args.campaignId === BigInt(id));
  check(created?.eventName === "CampaignCreated" && same(created.args.project, tx.from) &&
    created.args.grossDeposit === amount && created.args.protocolFee === fee &&
    created.args.celoPool === amount - fee &&
    created.args.requireIdentity === false, "Campaign creation event mismatch");
  const [atFunding, latest] = await Promise.all([
    client.readContract({ address, abi: celoPoolAbi, functionName: "campaigns", args: [BigInt(id)], blockNumber: receipt.blockNumber }),
    client.readContract({ address, abi: celoPoolAbi, functionName: "campaigns", args: [BigInt(id)] }),
  ]);
  for (const state of [atFunding, latest]) {
    check(same(state[0], tx.from) &&
      state[1] === amount && state[2] === fee && state[3] === amount - fee && state[4] === 0n &&
      same(state[5], `0x${"00".repeat(32)}`) &&
      !state[6] && !state[7] && state[8] === block.timestamp + window,
      "CELO campaign has changed or was not settled correctly");
  }
  return {
    chainId: CELO_NETWORKS[networkId].chain.id, contractAddress: address.toLowerCase(), projectWallet: tx.from,
    // Persist confirmed contract state, never the campaign creator's target.
    onchainCampaignId: id, amountDepositedRaw: atFunding[1].toString(), celoPoolRaw: atFunding[3].toString(),
    protocolFeeRaw: atFunding[2].toString(), requireIdentity: false,
     claimDeadline: new Date(Number(atFunding[8]) * 1000), fundingTxHash: txHash, rewardStatus: "funded",
  };
}

export async function verifyCeloRoot(campaign: Campaign, txHash: string, root: string) {
  const { client, address, receipt, tx, block, decoded, events } = await verifiedTx(txHash, campaign);
  check(decoded.functionName === "publishRoot" && decoded.args[0] === BigInt(campaign.onchainCampaignId!) &&
    same(decoded.args[1], root) && same(tx.from, campaign.projectWallet), "Root transaction mismatch");
  check(campaign.claimDeadline && block.timestamp * 1000n <= BigInt(campaign.claimDeadline.getTime()),
    "Distribution was published after the CELO claim window expired");
  check(events.some(e => e.eventName === "RootPublished" && e.args.campaignId === decoded.args[0] &&
    same(e.args.merkleRoot, root)), "Missing root event");
  const state = await client.readContract({
    address, abi: celoPoolAbi, functionName: "campaigns", args: [BigInt(campaign.onchainCampaignId!)], blockNumber: receipt.blockNumber,
  });
  boundState(state, campaign);
  check(state[7] && same(state[5], root), "Published root does not match onchain state");
}

export async function verifyCeloClaim(campaign: Campaign, input: {
  txHash: string; walletAddress: string; amountRaw: string;
}, proof: string[]) {
  const { client, address, receipt, tx, block, decoded, events } = await verifiedTx(input.txHash, campaign);
  check(decoded.functionName === "claim" && decoded.args[0] === BigInt(campaign.onchainCampaignId!) &&
    decoded.args[1] === BigInt(input.amountRaw) && same(tx.from, input.walletAddress) &&
    decoded.args[2].length === proof.length && decoded.args[2].every((v, i) => same(v, proof[i])),
    "Claim transaction or proof mismatch");
  check(campaign.claimDeadline && block.timestamp * 1000n <= BigInt(campaign.claimDeadline.getTime()),
    "Claim occurred after deadline");
  check(events.some(e => e.eventName === "Claimed" && e.args.campaignId === decoded.args[0] &&
    same(e.args.creator, input.walletAddress) && e.args.amount === BigInt(input.amountRaw)), "Missing claim event");
  const state = await client.readContract({
    address, abi: celoPoolAbi, functionName: "campaigns", args: [BigInt(campaign.onchainCampaignId!)], blockNumber: receipt.blockNumber,
  });
  boundState(state, campaign);
  check(state[7] && same(state[5], campaign.merkleRoot) && state[4] >= BigInt(input.amountRaw) &&
    state[4] <= state[3], "Invalid CELO claim state");
  check(await client.readContract({
    address, abi: celoPoolAbi, functionName: "hasClaimed",
    args: [BigInt(campaign.onchainCampaignId!), input.walletAddress as Address], blockNumber: receipt.blockNumber,
  }), "Claim flag not set");
}

export async function verifyCeloRefund(campaign: Campaign, txHash: string) {
  const { client, address, receipt, tx, block, decoded, events } = await verifiedTx(txHash, campaign);
  check(decoded.functionName === "withdrawUnclaimed" && decoded.args[0] === BigInt(campaign.onchainCampaignId!) &&
    same(tx.from, campaign.projectWallet), "Refund transaction mismatch");
  check(campaign.claimDeadline && block.timestamp * 1000n > BigInt(campaign.claimDeadline.getTime()),
    "Claim window has not expired");
  const state = await client.readContract({
    address, abi: celoPoolAbi, functionName: "campaigns", args: [BigInt(campaign.onchainCampaignId!)], blockNumber: receipt.blockNumber,
  });
  boundState(state, campaign);
  check(state[4] === state[3] && events.some(e => e.eventName === "UnclaimedWithdrawn" &&
    e.args.campaignId === decoded.args[0] && e.args.amount > 0n && e.args.amount <= state[3]), "Refund not reflected onchain");
}

export async function celoClaimAvailable(campaign: Campaign, walletAddress: string) {
  const { client, address } = await readyCeloClient(campaign);
  const [state, claimed, block] = await Promise.all([
    client.readContract({ address, abi: celoPoolAbi, functionName: "campaigns", args: [BigInt(campaign.onchainCampaignId!)] }),
    client.readContract({ address, abi: celoPoolAbi, functionName: "hasClaimed", args: [BigInt(campaign.onchainCampaignId!), walletAddress as Address] }),
    client.getBlock(),
  ]);
  boundState(state, campaign);
  return !claimed && state[7] && same(state[5], campaign.merkleRoot) &&
    state[4] < state[3] && block.timestamp <= state[8];
}