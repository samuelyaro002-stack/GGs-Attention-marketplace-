import {
  decodeFunctionData, getAddress, parseEventLogs,
  type Address, type Hash,
} from "viem";
import { celoRewardPoolAbi, legacyCeloRewardPoolAbi, CELO_DEPLOYMENT } from "@workspace/celo-contract";
import type { Campaign, Submission } from "@workspace/db";
import {
  CeloVerificationError, celoConfigForNetwork, celoNetworkIdForChainId,
  celoPublicClientForNetwork, selectedCeloNetworkId, type CeloNetworkId,
} from "./celo-reward-verification";
import { normalizeNonzeroWalletAddress } from "./reward-eligibility";

const same = (a: string | null | undefined, b: string | null | undefined) =>
  Boolean(a && b && a.toLowerCase() === b.toLowerCase());
function check(value: unknown, message: string, status = 409): asserts value {
  if (!value) throw new CeloVerificationError(message, status);
}
export async function celoConfigV3(networkId: CeloNetworkId = selectedCeloNetworkId()) {
  const config = await celoConfigForNetwork(networkId);
  if (networkId === "sepolia" && config.ready && !same(config.contractAddress, CELO_DEPLOYMENT.contractAddress)) {
    return { ...config, ready: false,
      reason: "This version requires the replacement CELO deployment. Update the approved contract configuration before funding or paying." };
  }
  return config;
}

export async function readCeloState(campaign: Campaign) {
  const networkId = celoNetworkIdForChainId(campaign.chainId);
  check(networkId, "Campaign uses an unsupported Celo network", 409);
  const config = await celoConfigV3(networkId);
  check(config.ready && config.contractAddress, config.reason ?? "Deployment unavailable", 503);
  check(campaign.rewardAsset === "CELO" && campaign.chainId === config.chainId &&
    campaign.onchainCampaignId !== null &&
    same(campaign.contractAddress, config.contractAddress),
    "This campaign is not bound to the current CELO deployment");
  const address = getAddress(config.contractAddress);
  const id = BigInt(campaign.onchainCampaignId);
  const client = celoPublicClientForNetwork(networkId);
  const state = await client.readContract({ address, abi: celoRewardPoolAbi, functionName: "campaigns", args: [id] });
  check(same(state[0], campaign.projectWallet) && state[1] > 0n &&
    state[1].toString() === campaign.amountDepositedRaw &&
    state[2].toString() === campaign.protocolFeeRaw &&
    state[3].toString() === campaign.celoPoolRaw && state[4] <= state[3] && !state[5] &&
    Number(state[6]) * 1000 === campaign.claimDeadline?.getTime(),
    "Verified CELO deposit does not match the campaign record");
  return { address, id, state, client, config };
}

export async function hydrateCeloBalances(campaign: Campaign) {
  if (campaign.rewardAsset !== "CELO" || campaign.rewardStatus === "draft") {
    return { ...campaign, celoDistributedRaw: "0", celoRemainingRaw: "0" };
  }
  const networkId = celoNetworkIdForChainId(campaign.chainId);
  check(networkId, "Funded CELO campaign uses an unsupported network", 503);
  check(campaign.contractAddress && campaign.onchainCampaignId !== null,
    "Funded CELO campaign has no verified contract binding");
  const client = celoPublicClientForNetwork(networkId);
  const config = await celoConfigV3(networkId);
  const isCurrentDeployment = same(campaign.contractAddress, config.contractAddress);
  if (isCurrentDeployment) check(config.ready, config.reason ?? "Deployment unavailable", 503);
  const state = isCurrentDeployment
    ? (await readCeloState(campaign)).state
    : await client.readContract({
      address: getAddress(campaign.contractAddress), abi: legacyCeloRewardPoolAbi,
      functionName: "campaigns", args: [BigInt(campaign.onchainCampaignId)],
    });
  check(await client.getChainId() === config.chainId && same(state[0], campaign.projectWallet) &&
    state[1].toString() === campaign.amountDepositedRaw &&
    state[2].toString() === campaign.protocolFeeRaw &&
    state[3].toString() === campaign.celoPoolRaw && state[4] <= state[3],
    "On-chain campaign balances do not match the verified funding record", 503);
  return { ...campaign, amountDepositedRaw: state[1].toString(),
    protocolFeeRaw: state[2].toString(), celoPoolRaw: state[3].toString(),
    celoDistributedRaw: state[4].toString(), celoRemainingRaw: (state[3] - state[4]).toString() };
}

export function xpAllocations(pool: bigint, submissions: Submission[]) {
  check(submissions.length > 0, "Add creator submissions before distribution");
  const grouped = new Map<string, { walletAddress: Address; xp: number; handle: string }>();
  for (const submission of submissions) {
    const wallet = normalizeNonzeroWalletAddress(submission.walletAddress ?? "");
    check(wallet && Number.isSafeInteger(submission.xp) && submission.xp > 0,
      "Every submission needs a valid wallet and positive XP");
    const existing = grouped.get(wallet.toLowerCase());
    const xp = (existing?.xp ?? 0) + submission.xp;
    check(Number.isSafeInteger(xp), "Total creator XP exceeds the safe range");
    grouped.set(wallet.toLowerCase(), { walletAddress: getAddress(wallet), xp, handle: existing?.handle ?? submission.handle });
  }
  const rows = [...grouped.values()].sort((a, b) => b.xp - a.xp || a.walletAddress.localeCompare(b.walletAddress));
  const totalXp = rows.reduce((sum, row) => sum + row.xp, 0);
  check(Number.isSafeInteger(totalXp) && totalXp > 0 && pool > 0n, "Invalid XP shares or creator pool");
  let allocated = 0n;
  const payouts = rows.map(row => {
    const amount = pool * BigInt(row.xp) / BigInt(totalXp);
    allocated += amount;
    return { ...row, amount };
  });
  // Assign indivisible remainder deterministically to the top-XP wallet.
  payouts[0].amount += pool - allocated;
  check(payouts.every(row => row.amount > 0n), "Pool is too small to pay every creator wallet");
  return { totalXp, payouts };
}

export async function payoutPreview(campaign: Campaign, submissions: Submission[]) {
  type CreatorRow = { id: number; handle: string; walletAddress: string; xp: number; payoutRaw: string; paid: boolean };
  const base = {
    id: campaign.id, name: campaign.name, rewardStatus: campaign.rewardStatus,
    target: campaign.celoTargetAmount, contractAddress: campaign.contractAddress,
    onchainCampaignId: campaign.onchainCampaignId,
  };
  if (campaign.rewardStatus === "draft") {
    const totalXp = submissions.reduce((sum, row) => sum + row.xp, 0);
    return { ...base, grossRaw: "0", feeRaw: "0", poolRaw: "0", distributedRaw: "0",
      remainingRaw: "0", payoutDeadline: null, totalXp,
      submissions: submissions.map(row => ({ id: row.id, handle: row.handle,
        walletAddress: row.walletAddress ?? "", xp: row.xp, payoutRaw: "0", paid: false })) as CreatorRow[], recipients: [],
      amounts: [], eligible: false, reason: "Fund this campaign before distributing payouts." };
  }
  const networkId = celoNetworkIdForChainId(campaign.chainId);
  check(networkId, "Campaign uses an unsupported Celo network", 503);
  const config = await celoConfigV3(networkId);
  const client = celoPublicClientForNetwork(networkId);
  // Historical contracts remain in the database but must never be paid through a new ABI.
  if (!same(campaign.contractAddress, config.contractAddress)) {
    const live = await hydrateCeloBalances(campaign);
    const paid = await Promise.all(submissions.map(row => {
      const wallet = normalizeNonzeroWalletAddress(row.walletAddress ?? "");
      return wallet ? client.readContract({ address: getAddress(campaign.contractAddress!),
        abi: legacyCeloRewardPoolAbi, functionName: "hasClaimed",
        args: [BigInt(campaign.onchainCampaignId!), getAddress(wallet)] }) : false;
    }));
    const { payouts, totalXp } = xpAllocations(BigInt(live.celoPoolRaw), submissions);
    return { ...base, grossRaw: live.amountDepositedRaw, feeRaw: live.protocolFeeRaw,
      poolRaw: live.celoPoolRaw, distributedRaw: live.celoDistributedRaw,
      remainingRaw: live.celoRemainingRaw, payoutDeadline: campaign.claimDeadline, totalXp,
      submissions: submissions.map((row, index) => ({ id: row.id, handle: row.handle,
        walletAddress: row.walletAddress ?? "", xp: row.xp,
        payoutRaw: proportionalSubmissionAmounts(submissions, payouts).get(row.id) ?? "0",
        paid: Boolean(paid[index]) })) as CreatorRow[], recipients: [],
      amounts: [], eligible: false, reason: "Historical contract; this payout panel supports the new deployment only." };
  }
  const { address, id, state } = await readCeloState(campaign);
  const [project, gross, fee, pool, distributed, , deadline] = state;
  let totalXp = 0;
  let rows: Array<{ walletAddress: Address; handle: string; xp: number; amount: bigint }> = [];
  let reason: string | null = null;
  try {
    const allocations = xpAllocations(pool, submissions);
    totalXp = allocations.totalXp;
    rows = allocations.payouts;
  } catch (error) {
    reason = error instanceof Error ? error.message : "Unable to calculate XP payouts";
  }
  const paid = await Promise.all(rows.map(row =>
    client.readContract({ address, abi: celoRewardPoolAbi, functionName: "hasBeenPaid", args: [id, row.walletAddress] })));
  // If a different distribution was made onchain, do not send another batch from stale XP.
  const accounted = rows.reduce((sum, row, index) => sum + (paid[index] ? row.amount : 0n), 0n);
  if (distributed !== accounted) reason = "On-chain payouts do not match current XP allocations. Review this campaign before sending another batch.";
  const pending = rows.filter((row, index) => !paid[index]);
  if (pending.length === 0 && rows.length > 0) reason = "Every creator wallet has been paid.";
  if (distributed >= pool && pending.length > 0) reason = "The pool has no remaining CELO to distribute.";
  if (!same(project, campaign.projectWallet)) reason = "On-chain funding wallet differs from the campaign.";
  if (campaign.rewardStatus === "closed") reason = "This campaign is closed.";
  if (networkId !== selectedCeloNetworkId()) reason = "This campaign belongs to a different Celo network. Select its approved network before sending payouts.";
  const submissionAmounts = proportionalSubmissionAmounts(submissions, rows);
  return {
    ...base, grossRaw: gross.toString(), feeRaw: fee.toString(), poolRaw: pool.toString(),
    distributedRaw: distributed.toString(), remainingRaw: (pool - distributed).toString(),
    payoutDeadline: new Date(Number(deadline) * 1000), totalXp,
    submissions: submissions.map(submission => {
      const index = rows.findIndex(row => same(row.walletAddress, submission.walletAddress));
      return { id: submission.id, handle: submission.handle, walletAddress: submission.walletAddress ?? "",
        xp: submission.xp, payoutRaw: submissionAmounts.get(submission.id) ?? "0",
        paid: index >= 0 ? paid[index] : false };
    }),
    recipients: reason ? [] : pending.map(row => row.walletAddress),
    amounts: reason ? [] : pending.map(row => row.amount.toString()),
    eligible: reason === null && pending.length > 0,
    reason,
  };
}

function proportionalSubmissionAmounts(submissions: Submission[],
  wallets: Array<{ walletAddress: Address; xp: number; amount: bigint }>) {
  const amounts = new Map<number, string>();
  for (const wallet of wallets) {
    const entries = submissions.filter(row => same(row.walletAddress, wallet.walletAddress))
      .sort((a, b) => b.xp - a.xp || a.id - b.id);
    let allocated = 0n;
    const parts = entries.map(entry => {
      const amount = wallet.amount * BigInt(entry.xp) / BigInt(wallet.xp);
      allocated += amount;
      return { id: entry.id, amount };
    });
    if (parts.length) parts[0].amount += wallet.amount - allocated;
    for (const part of parts) amounts.set(part.id, part.amount.toString());
  }
  return amounts;
}

export async function verifyCeloFundingV3(txHash: string, campaignId: number) {
  check(/^0x[a-f0-9]{64}$/i.test(txHash) && Number.isSafeInteger(campaignId) && campaignId >= 0 && campaignId <= 2147483647,
    "Invalid funding hash or campaign ID", 400);
  const networkId = selectedCeloNetworkId();
  const config = await celoConfigV3(networkId);
  check(config.ready && config.contractAddress, config.reason ?? "CELO deployment unavailable", 503);
  const client = celoPublicClientForNetwork(networkId);
  const address = getAddress(config.contractAddress);
  const [receipt, tx] = await Promise.all([
    client.getTransactionReceipt({ hash: txHash as Hash }), client.getTransaction({ hash: txHash as Hash }),
  ]);
  check(receipt.status === "success" && same(tx.to, address) && tx.value === 0n &&
    tx.blockHash === receipt.blockHash, "Funding was not a confirmed contract call", 400);
  const decoded = decodeFunctionData({ abi: celoRewardPoolAbi, data: tx.input });
  check(decoded.functionName === "createCampaign", "Expected createCampaign call", 400);
  const [amount, identity, window] = decoded.args;
  check(amount > 0n && identity === false && window === 14n * 86400n, "Unexpected funding terms", 400);
  const logs = parseEventLogs({ abi: celoRewardPoolAbi,
    logs: receipt.logs.filter(log => same(log.address, address)), strict: true });
  const created = logs.find(log => log.eventName === "CampaignCreated");
  check(created?.eventName === "CampaignCreated" && created.args.campaignId === BigInt(campaignId),
    "Missing CampaignCreated event", 400);
  check(created && same(created.args.project, tx.from) && created.args.grossDeposit === amount &&
    created.args.protocolFee === amount / 10n && created.args.celoPool === amount - amount / 10n &&
    !created.args.requireIdentity, "CampaignCreated event does not match funding", 400);
  const [atFunding, latest, block] = await Promise.all([
    client.readContract({ address, abi: celoRewardPoolAbi, functionName: "campaigns",
      args: [BigInt(campaignId)], blockNumber: receipt.blockNumber }),
    client.readContract({ address, abi: celoRewardPoolAbi, functionName: "campaigns", args: [BigInt(campaignId)] }),
    client.getBlock({ blockHash: receipt.blockHash }),
  ]);
  for (const state of [atFunding, latest]) {
    check(same(state[0], tx.from) && state[1] === amount && state[2] === created.args.protocolFee &&
      state[3] === created.args.celoPool && !state[5] &&
      state[6] === block.timestamp + window,
      "On-chain campaign differs from the transaction", 400);
  }
  check(atFunding[4] === 0n, "Campaign was distributed before funding settled", 400);
  return { chainId: config.chainId, contractAddress: address.toLowerCase(), projectWallet: tx.from,
    onchainCampaignId: campaignId, amountDepositedRaw: atFunding[1].toString(),
    protocolFeeRaw: atFunding[2].toString(), celoPoolRaw: atFunding[3].toString(),
    requireIdentity: false, claimDeadline: new Date(Number(atFunding[6]) * 1000),
    fundingTxHash: txHash, rewardStatus: "funded" };
}

export async function verifyCeloPayout(campaign: Campaign, submissions: Submission[], txHash: string) {
  check(/^0x[a-f0-9]{64}$/i.test(txHash), "Invalid payout hash", 400);
  const { client, address, id, state, config } = await readCeloState(campaign);
  const [receipt, tx] = await Promise.all([
    client.getTransactionReceipt({ hash: txHash as Hash }), client.getTransaction({ hash: txHash as Hash }),
  ]);
  check(receipt.status === "success" && same(tx.to, address) && tx.value === 0n &&
    tx.blockHash === receipt.blockHash && same(tx.from, config.ownerWallet),
    "Payout did not originate from the approved contract administrator", 400);
  const decoded = decodeFunctionData({ abi: celoRewardPoolAbi, data: tx.input });
  check(decoded.functionName === "distributeBatch" && decoded.args[0] === id,
    "Transaction is not a payout for this campaign", 400);
  const [recipients, amounts] = [decoded.args[1], decoded.args[2]];
  const { payouts } = xpAllocations(state[3], submissions);
  check(recipients.length > 0 && recipients.length === amounts.length, "Empty or mismatched payout batch", 400);
  const expected = new Map(payouts.map(row => [row.walletAddress.toLowerCase(), row.amount]));
  const seen = new Set<string>();
  for (let i = 0; i < recipients.length; i++) {
    const key = recipients[i].toLowerCase();
    check(!seen.has(key) && expected.get(key) === amounts[i], "Payout differs from frozen XP shares", 400);
    seen.add(key);
  }
  const events = parseEventLogs({ abi: celoRewardPoolAbi,
    logs: receipt.logs.filter(log => same(log.address, address)), strict: true })
    .filter(log => log.eventName === "Distributed" && log.args.campaignId === id);
  check(events.length === recipients.length &&
    events.every((event, index) => event.eventName === "Distributed" &&
      same(event.args.creator, recipients[index]) &&
      event.args.amount === amounts[index]), "Verified payout events do not match the batch", 400);
  const atReceipt = await client.readContract({ address, abi: celoRewardPoolAbi, functionName: "campaigns",
    args: [id], blockNumber: receipt.blockNumber });
  check(atReceipt[4] >= amounts.reduce((sum, amount) => sum + amount, 0n) && atReceipt[4] <= state[3],
    "On-chain payout was not accounted for", 400);
  const paid = await Promise.all(recipients.map(recipient =>
    client.readContract({ address, abi: celoRewardPoolAbi, functionName: "hasBeenPaid",
      args: [id, recipient], blockNumber: receipt.blockNumber })));
  check(paid.every(Boolean), "Recipient paid flag missing from confirmed block", 400);
}

export async function verifyCeloRefundV3(campaign: Campaign, txHash: string) {
  const { address, id, client, state } = await readCeloState(campaign);
  check(/^0x[a-f0-9]{64}$/i.test(txHash), "Invalid withdrawal hash", 400);
  const [receipt, tx] = await Promise.all([
    client.getTransactionReceipt({ hash: txHash as Hash }), client.getTransaction({ hash: txHash as Hash }),
  ]);
  check(receipt.status === "success" && tx.value === 0n && same(tx.to, address) &&
    same(tx.from, state[0]) && tx.blockHash === receipt.blockHash, "Invalid withdrawal transaction", 400);
  const decoded = decodeFunctionData({ abi: celoRewardPoolAbi, data: tx.input });
  check(decoded.functionName === "withdrawRemaining" && decoded.args[0] === id, "Wrong withdrawal call", 400);
  const block = await client.getBlock({ blockHash: receipt.blockHash });
  check(block.timestamp > state[6], "Payout window has not closed", 400);
  const atReceipt = await client.readContract({ address, abi: celoRewardPoolAbi,
    functionName: "campaigns", args: [id], blockNumber: receipt.blockNumber });
  check(atReceipt[4] === state[3], "Withdrawal not reflected onchain", 400);
  const events = parseEventLogs({ abi: celoRewardPoolAbi,
    logs: receipt.logs.filter(log => same(log.address, address)), strict: true });
  check(events.some(event => event.eventName === "RemainingWithdrawn" &&
    event.args.campaignId === id && event.args.amount > 0n), "Missing withdrawal event", 400);
}
