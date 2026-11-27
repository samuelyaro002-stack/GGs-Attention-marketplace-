import type { Campaign } from "@workspace/db";

export type RewardCampaignSnapshot = Pick<
  Campaign,
  | "chainId"
  | "contractAddress"
  | "projectWallet"
  | "onchainCampaignId"
  | "requireIdentity"
  | "ethFundedRaw"
  | "gdPoolRaw"
  | "merkleRoot"
  | "claimDeadline"
  | "rewardStatus"
>;

export function normalizeRewardContractAddress(address: string): string {
  return address.toLowerCase();
}

export function rewardSnapshotMatches(
  current: RewardCampaignSnapshot,
  expected: RewardCampaignSnapshot,
): boolean {
  return rewardBindingMatches(current, expected) &&
    current.rewardStatus === expected.rewardStatus;
}

export function rewardBindingMatches(
  current: RewardCampaignSnapshot,
  expected: RewardCampaignSnapshot,
): boolean {
  const normalizeAddress = (address: string | null) =>
    address?.toLowerCase() ?? null;
  const normalizeDate = (date: Date | null) => date?.getTime() ?? null;
  return current.chainId === expected.chainId &&
    normalizeAddress(current.contractAddress) === normalizeAddress(expected.contractAddress) &&
    normalizeAddress(current.projectWallet) === normalizeAddress(expected.projectWallet) &&
    current.onchainCampaignId === expected.onchainCampaignId &&
    current.requireIdentity === expected.requireIdentity &&
    current.ethFundedRaw === expected.ethFundedRaw &&
    current.gdPoolRaw === expected.gdPoolRaw &&
    current.merkleRoot === expected.merkleRoot &&
    normalizeDate(current.claimDeadline) === normalizeDate(expected.claimDeadline);
}