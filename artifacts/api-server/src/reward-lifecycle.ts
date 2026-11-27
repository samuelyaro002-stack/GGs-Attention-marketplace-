import {
  rewardBindingMatches,
  type RewardCampaignSnapshot,
} from "./reward-state";

export type RewardLifecycleStatus =
  | "draft"
  | "funded"
  | "swapped"
  | "root-published"
  | "claiming"
  | "closed";

const CLAIMABLE_STATUSES = new Set<RewardLifecycleStatus>([
  "root-published",
  "claiming",
  "closed",
]);

export function submissionsAreOpen(status: string): boolean {
  return status === "draft";
}

export function statusAfterVerifiedClaim(
  currentStatus: string,
  fullyClaimed: boolean,
): RewardLifecycleStatus | null {
  if (!CLAIMABLE_STATUSES.has(currentStatus as RewardLifecycleStatus)) return null;
  if (currentStatus === "closed") return "closed";
  return fullyClaimed ? "closed" : "claiming";
}

export function canRecordVerifiedRefund(status: string): boolean {
  return status === "root-published" || status === "claiming";
}

export function claimStatusForBoundCampaign(
  current: RewardCampaignSnapshot,
  expected: RewardCampaignSnapshot,
  fullyClaimed: boolean,
): RewardLifecycleStatus | null {
  if (!rewardBindingMatches(current, expected)) return null;
  return statusAfterVerifiedClaim(current.rewardStatus, fullyClaimed);
}

export function refundStatusForBoundCampaign(
  current: RewardCampaignSnapshot,
  expected: RewardCampaignSnapshot,
): "closed" | null {
  if (!rewardBindingMatches(current, expected)) return null;
  return canRecordVerifiedRefund(current.rewardStatus) || current.rewardStatus === "closed"
    ? "closed"
    : null;
}