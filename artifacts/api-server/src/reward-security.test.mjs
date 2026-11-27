import assert from "node:assert/strict";
import test from "node:test";
import {
  allowedRequestOrigin,
  normalizeOrigin,
} from "./middlewares/origin-security.ts";
import { isAddress } from "viem";
import {
  getFundingEligibility,
  isValidNonzeroWalletAddress,
  normalizeNonzeroWalletAddress,
  rewardEligibilityError,
  NO_REWARD_WALLETS_MESSAGE,
} from "./reward-eligibility.ts";
import {
  claimDeadlineFromChainTimestamp,
  isIdentityPolicyEnabled,
} from "./reward-guards.ts";
import {
  normalizeRewardContractAddress,
  rewardBindingMatches,
  rewardSnapshotMatches,
} from "./reward-state.ts";
import { buildRewardDistribution } from "./reward-pool.ts";
import {
  claimStatusForBoundCampaign,
  canRecordVerifiedRefund,
  refundStatusForBoundCampaign,
  statusAfterVerifiedClaim,
  submissionsAreOpen,
} from "./reward-lifecycle.ts";
import {
  isRewardSwapQuoteFresh,
  minimumReceivedFromQuote,
  parseSlippageBps,
  REWARD_SWAP_QUOTE_TTL_MS,
} from "../../ggs-marketplace/src/lib/reward-quote.ts";
import { getConfiguredAdminIds, isAdminUser } from "./middlewares/security.ts";

test("creator reward wallets must be valid and non-zero", () => {
  const lowercaseWallet =
    "0x52908400098527886e0f7030069857d2e4169ee7";
  assert.equal(
    isValidNonzeroWalletAddress(lowercaseWallet),
    true,
  );
  assert.equal(
    normalizeNonzeroWalletAddress(lowercaseWallet),
    "0x52908400098527886E0F7030069857D2E4169EE7",
  );
  assert.equal(
    isValidNonzeroWalletAddress("0x0000000000000000000000000000000000000000"),
    false,
  );
  assert.equal(isValidNonzeroWalletAddress("0x1234"), false);
});

test("mixed-case invalid-checksum legacy wallets fail eligibility before distribution", () => {
  const invalidMixedChecksum =
    "0x52908400098527886E0F7030069857D2E4169Ee7";
  assert.equal(/^0x[a-fA-F0-9]{40}$/.test(invalidMixedChecksum), true);
  assert.equal(isAddress(invalidMixedChecksum), false);
  assert.equal(isValidNonzeroWalletAddress(invalidMixedChecksum), false);
  assert.equal(
    rewardEligibilityError([{ walletAddress: invalidMixedChecksum }]),
    NO_REWARD_WALLETS_MESSAGE,
  );
  assert.throws(
    () =>
      buildRewardDistribution(1, "100", [
        { walletAddress: invalidMixedChecksum, handle: "creator", xp: 10 },
      ]),
    /valid wallet address/,
  );
});

test("public funding eligibility covers state, configuration, and submission prerequisites", () => {
  const campaign = {
    chainId: 42220,
    contractAddress: null,
    projectWallet: null,
    onchainCampaignId: null,
    requireIdentity: true,
    rewardStatus: "draft",
  };
  const eligibleSubmissions = [{ walletAddress: "0x52908400098527886e0f7030069857d2e4169ee7" }];
  assert.deepEqual(
    getFundingEligibility(campaign, eligibleSubmissions, true),
    { eligible: true, reason: null },
  );
  assert.equal(
    getFundingEligibility(campaign, [], true).reason,
    "Add at least one creator submission before funding real rewards.",
  );
  assert.equal(
    getFundingEligibility(
      campaign,
      [{ walletAddress: "0x52908400098527886E0F7030069857D2E4169Ee7" }],
      true,
    ).reason,
    NO_REWARD_WALLETS_MESSAGE,
  );
  assert.equal(
    getFundingEligibility(campaign, eligibleSubmissions, false).reason,
    "Onchain reward pool verification is not configured.",
  );
  assert.equal(
    getFundingEligibility(
      { ...campaign, rewardStatus: "funded" },
      eligibleSubmissions,
      true,
    ).eligible,
    false,
  );
});

test("same-origin checks reject an untrusted forwarded host", () => {
  const allowed = allowedRequestOrigin({
    origin: "https://attacker.example",
    requestHostname: "attacker.example",
    requestProtocol: "https",
    configuredOrigins: new Set(),
    trustedHostnames: new Set(["campaign.example"]),
  });
  assert.equal(allowed, null);

  assert.equal(
    allowedRequestOrigin({
      origin: "https://campaign.example",
      requestHostname: "campaign.example",
      requestProtocol: "https",
      configuredOrigins: new Set(),
      trustedHostnames: new Set(["campaign.example"]),
    }),
    "https://campaign.example",
  );
  assert.equal(normalizeOrigin("https://campaign.example/path"), null);
  assert.equal(
    allowedRequestOrigin({
      origin: "https://campaign.example:8443",
      requestHostname: "campaign.example",
      requestProtocol: "https",
      configuredOrigins: new Set(),
      trustedHostnames: new Set(["campaign.example"]),
    }),
    null,
  );
});

test("onchain contract address bindings normalize case", () => {
  assert.equal(
    normalizeRewardContractAddress("0xAbCd"),
    normalizeRewardContractAddress("0xabcd"),
  );
});

test("reward transitions reject a campaign changed during chain verification", () => {
  const before = {
    chainId: 42220,
    contractAddress: "0xABCDEF",
    projectWallet: "0x123456",
    onchainCampaignId: 7,
    requireIdentity: true,
    ethFundedRaw: "100",
    gdPoolRaw: "200",
    rewardStatus: "funded",
  };
  assert.equal(rewardSnapshotMatches({ ...before }, before), true);
  assert.equal(
    rewardSnapshotMatches({ ...before, rewardStatus: "swapped" }, before),
    false,
  );
  assert.equal(
    rewardSnapshotMatches({ ...before, onchainCampaignId: 8 }, before),
    false,
  );
  assert.equal(
    rewardBindingMatches({ ...before, rewardStatus: "claiming" }, before),
    true,
  );
  assert.equal(
    rewardBindingMatches({ ...before, gdPoolRaw: "201" }, before),
    false,
  );
});

test("identity verification must be enabled in calldata, event, and stored state", () => {
  assert.equal(isIdentityPolicyEnabled(true, true, true), true);
  assert.equal(isIdentityPolicyEnabled(true, false, true), false);
  assert.equal(isIdentityPolicyEnabled(true, true, false), false);
});

test("claim deadline uses the onchain value and rejects zero or unsafe timestamps", () => {
  assert.equal(
    claimDeadlineFromChainTimestamp(1_800_000_000n).getTime(),
    1_800_000_000_000,
  );
  assert.throws(() => claimDeadlineFromChainTimestamp(0n), /claim deadline is invalid/);
  assert.throws(
    () => claimDeadlineFromChainTimestamp(9_007_199_254_741n),
    /claim deadline is invalid/,
  );
});

test("reward lifecycle freezes submissions before payouts and closes safely", () => {
  assert.equal(submissionsAreOpen("draft"), true);
  assert.equal(submissionsAreOpen("funded"), false);
  assert.equal(submissionsAreOpen("swapped"), false);
  assert.equal(statusAfterVerifiedClaim("root-published", false), "claiming");
  assert.equal(statusAfterVerifiedClaim("claiming", true), "closed");
  assert.equal(statusAfterVerifiedClaim("closed", false), "closed");
  assert.equal(statusAfterVerifiedClaim("funded", false), null);
  assert.equal(canRecordVerifiedRefund("root-published"), true);
  assert.equal(canRecordVerifiedRefund("claiming"), true);
  assert.equal(canRecordVerifiedRefund("closed"), false);
});

test("overlapping claim and refund records cannot downgrade a closed campaign", async () => {
  const original = {
    chainId: 42220,
    contractAddress: "0xABCDEF",
    projectWallet: "0x123456",
    onchainCampaignId: 7,
    requireIdentity: true,
    ethFundedRaw: "100",
    gdPoolRaw: "200",
    merkleRoot: `0x${"ab".repeat(32)}`,
    claimDeadline: new Date("2030-01-01T00:00:00.000Z"),
    rewardStatus: "root-published",
  };
  const updateInOrder = async (operations) => {
    let row = { ...original };
    let mutex = Promise.resolve();
    const update = (operation) => {
      const result = mutex.then(() => {
        const nextStatus = operation(row);
        if (!nextStatus) return false;
        row = { ...row, rewardStatus: nextStatus };
        return true;
      });
      mutex = result.then(() => undefined, () => undefined);
      return result;
    };
    await Promise.all(operations.map(update));
    return row.rewardStatus;
  };
  const recordClaim = (row) =>
    claimStatusForBoundCampaign(row, original, false);
  const recordRefund = (row) =>
    refundStatusForBoundCampaign(row, original);
  assert.equal(await updateInOrder([recordClaim, recordRefund]), "closed");
  assert.equal(await updateInOrder([recordRefund, recordClaim]), "closed");
  assert.equal(
    claimStatusForBoundCampaign(
      { ...original, gdPoolRaw: "201" },
      original,
      false,
    ),
    null,
  );
});

test("swap minimum derives only from an explicit slippage value and a live quote", () => {
  assert.equal(parseSlippageBps("100"), 100);
  assert.equal(minimumReceivedFromQuote("1000000", 100), "990000");
  assert.throws(() => parseSlippageBps(""), /Enter slippage/);
  assert.throws(() => parseSlippageBps("10000"), /between 1 and 9,999/);
  assert.throws(() => minimumReceivedFromQuote("1", 9999), /zero G\$/);
  const quote = { quotedAt: 50_000 };
  assert.equal(isRewardSwapQuoteFresh(quote, 50_000), true);
  assert.equal(isRewardSwapQuoteFresh(quote, 50_000 + REWARD_SWAP_QUOTE_TTL_MS), false);
  assert.equal(isRewardSwapQuoteFresh({ quotedAt: 50_001 }, 50_000), false);
});

test("only explicitly configured administrator ids receive admin privileges", () => {
  const previous = process.env.PRIVY_ADMIN_USER_IDS;
  try {
    delete process.env.PRIVY_ADMIN_USER_IDS;
    assert.deepEqual(getConfiguredAdminIds(), new Set());
    assert.equal(isAdminUser("did:privy:first_signin"), false);
    process.env.PRIVY_ADMIN_USER_IDS = "did:privy:authorized, did:privy:second, user_old_clerk";
    assert.equal(isAdminUser("did:privy:authorized"), true);
    assert.equal(isAdminUser("did:privy:first_signin"), false);
    assert.equal(isAdminUser("user_old_clerk"), false);
  } finally {
    if (previous === undefined) delete process.env.PRIVY_ADMIN_USER_IDS;
    else process.env.PRIVY_ADMIN_USER_IDS = previous;
  }
});