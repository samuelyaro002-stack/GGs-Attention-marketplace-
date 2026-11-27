import { formatEther } from 'viem';
import { formatExactDecimal } from './locale-format';

type CeloPool = {
  celoTargetAmount?: string | null;
  amountDepositedRaw?: string;
  celoPoolRaw?: string;
  onchainCampaignId?: number | null;
  contractAddress?: string | null;
  rewardStatus: string;
};

export function celoPoolDisplay(campaign: CeloPool, legacyTarget = 'Not set (legacy campaign)') {
  const target = campaign.celoTargetAmount ? `${formatExactDecimal(campaign.celoTargetAmount)} CELO` : legacyTarget;
  const confirmed = campaign.rewardStatus !== 'draft' &&
    campaign.onchainCampaignId != null && Boolean(campaign.contractAddress);
  let deposit: string | null = null;
  if (confirmed && campaign.amountDepositedRaw && /^\d+$/.test(campaign.amountDepositedRaw)) {
    deposit = `${formatExactDecimal(formatEther(BigInt(campaign.amountDepositedRaw)))} CELO`;
  }
  return { target, deposit };
}

/** Estimated XP allocation from the verified net pool; never from target intent. */
export function celoRewardEstimate(campaign: CeloPool, xp: number, totalXp: number, notFunded = 'Not funded'): string {
  if (!celoPoolDisplay(campaign).deposit) return notFunded;
  if (!campaign.celoPoolRaw || !/^\d+$/.test(campaign.celoPoolRaw) ||
      !Number.isSafeInteger(xp) || !Number.isSafeInteger(totalXp) || totalXp <= 0) return '…';
  return `${formatExactDecimal(formatEther(BigInt(campaign.celoPoolRaw) * BigInt(xp) / BigInt(totalXp)))} CELO`;
}