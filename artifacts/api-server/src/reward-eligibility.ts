import { getAddress, isAddress } from "viem";

export function normalizeNonzeroWalletAddress(value: string): string | null {
  if (!isAddress(value)) return null;
  const normalized = getAddress(value);
  return /^0x0{40}$/i.test(normalized) ? null : normalized;
}

export function isValidNonzeroWalletAddress(value: string): boolean {
  return normalizeNonzeroWalletAddress(value) !== null;
}

export type RewardEligibleSubmission = {
  walletAddress: string | null;
};

export type FundingEligibilityCampaign = {
  chainId: number;
  contractAddress: string | null;
  projectWallet: string | null;
  onchainCampaignId: number | null;
  requireIdentity: boolean;
  rewardStatus: string;
};

export const NO_REWARD_WALLETS_MESSAGE =
  "Legacy demo submissions have no claim wallets. Create a new campaign for real rewards.";

export function rewardEligibilityError(
  submissions: RewardEligibleSubmission[],
): string | null {
  if (submissions.length === 0) {
    return "Add at least one creator submission before funding real rewards.";
  }
  return submissions.some(
    (submission) =>
      !submission.walletAddress ||
      !isValidNonzeroWalletAddress(submission.walletAddress),
  )
    ? NO_REWARD_WALLETS_MESSAGE
    : null;
}

export function getFundingEligibility(
  campaign: FundingEligibilityCampaign,
  submissions: RewardEligibleSubmission[],
  verificationConfigured: boolean,
): { eligible: boolean; reason: string | null } {
  if (
    campaign.rewardStatus !== "draft" ||
    campaign.chainId !== 42220 ||
    campaign.onchainCampaignId !== null ||
    campaign.contractAddress !== null ||
    campaign.projectWallet !== null ||
    !campaign.requireIdentity
  ) {
    return {
      eligible: false,
      reason: "Campaign funding is unavailable in its current state.",
    };
  }
  if (!verificationConfigured) {
    return {
      eligible: false,
      reason: "Onchain reward pool verification is not configured.",
    };
  }
  const reason = rewardEligibilityError(submissions);
  return { eligible: reason === null, reason };
}