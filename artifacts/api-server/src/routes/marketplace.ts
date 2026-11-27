import { hydrateCeloBalances } from "../celo-payout";
import { selectedCeloChainId } from "../celo-reward-verification";
import { Router, type IRouter } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  campaignsTable,
  type Campaign,
  type Submission,
  submissionsTable,
} from "@workspace/db";
import {
  CreateCampaignBody,
  CreateCampaignResponse,
  GetCampaignQuoteQueryParams,
  GetCampaignQuoteResponse,
  RefreshCampaignFundingQuoteParams,
  RefreshCampaignFundingQuoteResponse,
  CreateSubmissionBody,
  CreateSubmissionParams,
  CreateSubmissionResponse,
  GetCampaignLeaderboardParams,
  GetCampaignLeaderboardResponse,
  GetCampaignParams,
  GetCampaignResponse,
  GetMarketplaceSummaryResponse,
  GetRewardPoolClaimParams,
  GetRewardPoolClaimResponse,
  GetRewardPoolDistributionParams,
  GetRewardPoolDistributionResponse,
  GetRewardPoolEligibilityParams,
  GetRewardPoolEligibilityResponse,
  GetRewardPoolConfigResponse,
  ListCampaignsResponse,
  RecordRewardPoolClaimBody,
  RecordRewardPoolClaimParams,
  RecordRewardPoolClaimResponse,
  RecordRewardPoolFundingBody,
  RecordRewardPoolFundingParams,
  RecordRewardPoolFundingResponse,
  RecordRewardPoolRootBody,
  RecordRewardPoolRootParams,
  RecordRewardPoolRootResponse,
  RecordRewardPoolRefundBody,
  RecordRewardPoolRefundParams,
  RecordRewardPoolRefundResponse,
  RecordRewardPoolSwapBody,
  RecordRewardPoolSwapParams,
  RecordRewardPoolSwapResponse,
  type Campaign as ApiCampaign,
  type LeaderboardRow,
} from "@workspace/api-zod";
import {
  GDOLLAR_TOKEN_ADDRESS,
  REWARD_POOL_CHAIN_ID,
  REWARD_POOL_CHAIN_NAME,
  REWARD_POOL_CONTRACT_ADDRESS,
  buildRewardDistribution,
  getRewardClaim,
} from "../reward-pool";
import {
  cleanObject,
  isPositiveSafeInteger,
  isValidHttpLinkForPlatform,
  isValidNonzeroWalletAddress,
  normalizeNonzeroWalletAddress,
  requireAdmin,
  requireAuth,
} from "../middlewares/security";
import {
  getFundingEligibility,
  rewardEligibilityError,
} from "../reward-eligibility";
import {
  verifyClaim,
  verifyFunding,
  isRewardVerificationConfigured,
  verifyRoot,
  verifyRefund,
  verifySwap,
  isRewardClaimed,
  isRewardPoolDeploymentReady,
} from "../reward-verification";
import {
  normalizeRewardContractAddress,
  rewardSnapshotMatches,
} from "../reward-state";
import {
  canRecordVerifiedRefund,
  claimStatusForBoundCampaign,
  refundStatusForBoundCampaign,
  submissionsAreOpen,
} from "../reward-lifecycle";
import {
  CeloPriceUnavailableError,
  getCampaignQuote,
  validateDirectCeloAmount,
  verifyCampaignQuoteToken,
} from "../celo-price";

const router: IRouter = Router();

// Legacy G$ endpoints must never interpret a Sepolia CELO campaign.
router.use("/campaigns/:campaignId/reward-pool", async (req, res, next) => {
  const id = Number(req.params.campaignId);
  if (isPositiveSafeInteger(id)) {
    const campaign = await getCampaignById(id);
    if (campaign && campaign.rewardAsset !== "G$") {
      res.status(409).json({ error: "Use the CELO reward-pool endpoints for this campaign" });
      return;
    }
  }
  next();
});

router.use((req, res, next) => {
  if (req.method === "POST") {
    requireAuth(req, res, next);
    return;
  }
  next();
});

let seeded = false;
let seedPromise: Promise<void> | null = null;

const accountTrust: Record<string, number> = {
  "under-30-days": 0.65,
  "1-6-months": 0.85,
  established: 1,
};

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}

function simulatedEngagement(seed: string) {
  const hash = hashString(seed);
  const likes = 120 + (hash % 320);
  const reposts = 12 + ((hash >> 4) % 82);
  const replies = 8 + ((hash >> 8) % 52);
  return { likes, reposts, replies };
}

async function ensureSeeded(): Promise<void> {
  if (seeded) return;
  if (seedPromise) {
    await seedPromise;
    return;
  }

  seedPromise = seedMarketplace();
  try {
    await seedPromise;
  } finally {
    seedPromise = null;
  }
}

async function seedMarketplace(): Promise<void> {
  if (seeded) return;

  const existing = await db
    .select({ id: campaignsTable.id })
    .from(campaignsTable)
    .limit(1);

  if (existing.length === 0) {
    const [kora, arc] = await db
      .insert(campaignsTable)
      .values([
        {
          name: "Kora Protocol",
          brief:
            "Make cross-chain swaps feel simple. Tell the story of a faster, friendlier DeFi experience.",
          pool: 5000,
          cycle: "2 weeks",
        },
        {
          name: "Arcade Labs",
          brief:
            "Bring more builders into the open-source gaming ecosystem with practical, high-signal content.",
          pool: 2800,
          cycle: "1 week",
        },
      ])
      .returning();

    const firstSubmissions = [
      {
        campaignId: kora.id,
        handle: "@chainmaven",
        platform: "X (Twitter)",
        link: "https://x.com/chainmaven/status/184001",
        accountAge: "established",
        likes: 412,
        reposts: 86,
        replies: 38,
        trust: 1,
        xp: 698,
      },
      {
        campaignId: kora.id,
        handle: "@web3nana",
        platform: "X (Twitter)",
        link: "https://x.com/web3nana/status/184002",
        accountAge: "1-6-months",
        likes: 284,
        reposts: 54,
        replies: 21,
        trust: 0.85,
        xp: 443,
      },
      {
        campaignId: arc.id,
        handle: "@buildwithtomi",
        platform: "TikTok",
        link: "https://tiktok.com/@buildwithtomi/video/184003",
        accountAge: "established",
        likes: 338,
        reposts: 41,
        replies: 29,
        trust: 1,
        xp: 537,
      },
    ];

    await db.insert(submissionsTable).values(firstSubmissions);
  }

  seeded = true;
}

async function getSubmissions(campaignId?: number): Promise<Submission[]> {
  if (campaignId === undefined) {
    return db
      .select()
      .from(submissionsTable)
      .orderBy(desc(submissionsTable.createdAt));
  }

  return db
    .select()
    .from(submissionsTable)
    .where(eq(submissionsTable.campaignId, campaignId))
    .orderBy(desc(submissionsTable.createdAt));
}

export function serializeCampaign(
  campaign: Campaign & { celoDistributedRaw?: string; celoRemainingRaw?: string },
  submissions: Submission[],
): ApiCampaign {
  return {
    id: campaign.id,
    name: campaign.name,
    brief: campaign.brief,
    pool: campaign.pool,
    celoTargetAmount: campaign.celoTargetAmount,
    usdTargetAmount: campaign.usdTargetAmount,
    celoUsdRate: campaign.celoUsdRate,
    cycle: campaign.cycle,
    submissionsCount: submissions.length,
    xpAwarded: submissions.reduce((total, submission) => total + submission.xp, 0),
    createdAt: campaign.createdAt,
    rewardAsset: campaign.rewardAsset as ApiCampaign["rewardAsset"],
    chainId: campaign.chainId,
    contractAddress: campaign.contractAddress,
    projectWallet: campaign.projectWallet,
    onchainCampaignId: campaign.onchainCampaignId,
    requireIdentity: campaign.requireIdentity,
    ethFundedRaw: campaign.ethFundedRaw,
    gdPoolRaw: campaign.gdPoolRaw,
    amountDepositedRaw: campaign.amountDepositedRaw,
    celoPoolRaw: campaign.celoPoolRaw,
    protocolFeeRaw: campaign.protocolFeeRaw,
    celoDistributedRaw: campaign.celoDistributedRaw ?? "0",
    celoRemainingRaw: campaign.celoRemainingRaw ?? (campaign.rewardAsset === "CELO" ? campaign.celoPoolRaw : "0"),
    merkleRoot: campaign.merkleRoot,
    rewardStatus: campaign.rewardStatus as ApiCampaign["rewardStatus"],
    claimDeadline: campaign.claimDeadline,
  };
}

async function getCampaignById(id: number): Promise<Campaign | undefined> {
  const [campaign] = await db
    .select()
    .from(campaignsTable)
    .where(eq(campaignsTable.id, id));
  return campaign;
}

async function leaderboardFor(
  campaign: Campaign,
  submissions: Submission[],
): Promise<LeaderboardRow[]> {
  const byHandle = new Map<
    string,
    {
      handle: string;
      platform: string;
      posts: number;
      xp: number;
      trust: number;
    }
  >();

  for (const submission of submissions) {
    const existing = byHandle.get(submission.handle);
    if (existing) {
      existing.posts += 1;
      existing.xp += submission.xp;
      existing.trust = Math.max(existing.trust, submission.trust);
    } else {
      byHandle.set(submission.handle, {
        handle: submission.handle,
        platform: submission.platform,
        posts: 1,
        xp: submission.xp,
        trust: submission.trust,
      });
    }
  }

  const rows = Array.from(byHandle.values()).sort((a, b) => b.xp - a.xp);
  const totalXp = rows.reduce((total, row) => total + row.xp, 0) || 1;

  return rows.map((row, index) => ({
    rank: index + 1,
    handle: row.handle,
    platform: row.platform,
    posts: row.posts,
    xp: row.xp,
    share: row.xp / totalXp,
    estimatedReward: (row.xp / totalXp) * campaign.pool,
    trust: row.trust,
  }));
}

router.get("/marketplace/summary", async (_req, res): Promise<void> => {
  await ensureSeeded();
  const campaigns = await db
    .select()
    .from(campaignsTable)
    .orderBy(desc(campaignsTable.createdAt));
  const submissions = await getSubmissions();
  const creators = new Set(submissions.map((submission) => submission.handle));
  const campaignById = new Map(campaigns.map((campaign) => [campaign.id, campaign]));

  const recentActivity = [
    ...campaigns.map((campaign) => ({
      kind: "campaign",
      label: campaign.name,
      detail: `New campaign launched · $${campaign.pool.toLocaleString()} reward pool`,
      createdAt: campaign.createdAt,
    })),
    ...submissions.map((submission) => ({
      kind: "submission",
      label: submission.handle,
      detail: `Earned ${submission.xp.toLocaleString()} XP in ${
        campaignById.get(submission.campaignId)?.name ?? "a campaign"
      }`,
      createdAt: submission.createdAt,
    })),
  ]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 5);

  const data = {
    activeCampaigns: campaigns.length,
    creatorsSubmitted: creators.size,
    totalXp: submissions.reduce((total, submission) => total + submission.xp, 0),
    totalPool: campaigns.filter(campaign => campaign.rewardAsset === "G$").reduce((total, campaign) => total + campaign.pool, 0),
    recentActivity,
  };

  res.json(GetMarketplaceSummaryResponse.parse(data));
});

router.get("/reward-pool/config", async (_req, res): Promise<void> => {
  res.json(
    GetRewardPoolConfigResponse.parse({
      chainId: REWARD_POOL_CHAIN_ID,
      chainName: REWARD_POOL_CHAIN_NAME,
      tokenAddress: GDOLLAR_TOKEN_ADDRESS,
      contractAddress: REWARD_POOL_CONTRACT_ADDRESS,
      ready: await isRewardPoolDeploymentReady(),
    }),
  );
});

router.get("/campaign-quote", async (req, res): Promise<void> => {
  const parsed = GetCampaignQuoteQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a USD amount between $1 and $100,000." });
    return;
  }
  try {
    const quote = await getCampaignQuote(parsed.data.usdAmount);
    res.json(GetCampaignQuoteResponse.parse(quote));
  } catch (error) {
    if (error instanceof CeloPriceUnavailableError) {
      res.status(503).json({ error: error.message });
      return;
    }
    res.status(400).json({
      error: error instanceof Error ? error.message : "Invalid USD reward pool.",
    });
  }
});

router.get("/campaigns", async (_req, res): Promise<void> => {
  await ensureSeeded();
  const campaigns = await db
    .select()
    .from(campaignsTable)
    .orderBy(desc(campaignsTable.createdAt));
  const submissions = await getSubmissions();
  const submissionsByCampaign = new Map<number, Submission[]>();

  for (const submission of submissions) {
    const current = submissionsByCampaign.get(submission.campaignId) ?? [];
    current.push(submission);
    submissionsByCampaign.set(submission.campaignId, current);
  }

  let liveCampaigns;
  try { liveCampaigns = await Promise.all(campaigns.map(hydrateCeloBalances)); }
  catch { res.status(503).json({ error: "Confirmed CELO balances could not be read from the blockchain. No cached deposit is being shown." }); return; }
  res.json(
    ListCampaignsResponse.parse(
      liveCampaigns.map((campaign) =>
        serializeCampaign(campaign, submissionsByCampaign.get(campaign.id) ?? []),
      ),
    ),
  );
});

router.post("/campaigns", async (req, res): Promise<void> => {
  const parsed = CreateCampaignBody.safeParse(cleanObject(req.body));
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid campaign input" });
    return;
  }

  if (parsed.data.rewardAsset !== "CELO" || parsed.data.pool !== 0) {
    res.status(400).json({ error: "New campaign reward pools must use CELO." });
    return;
  }
  const hasUsdQuote = typeof parsed.data.usdTargetAmount === "string";
  const hasDirectAmount = typeof parsed.data.celoTargetAmount === "string";
  if (hasUsdQuote === hasDirectAmount) {
    res.status(400).json({ error: "Choose a USD quote or enter a direct CELO amount." });
    return;
  }

  let usdTargetAmount: string | null = null;
  let celoUsdRate: string | null = null;
  let celoTargetAmount: string;
  if (hasUsdQuote) {
    if (!parsed.data.quoteToken) {
      res.status(400).json({ error: "A current signed CELO quote is required." });
      return;
    }
    try {
      const quote = verifyCampaignQuoteToken(parsed.data.quoteToken, parsed.data.usdTargetAmount!);
      usdTargetAmount = quote.usdAmount;
      celoUsdRate = quote.rateUsd;
      celoTargetAmount = quote.celoAmount;
    } catch (error) {
      res.status(409).json({
        error: error instanceof Error ? error.message : "Refresh the CELO quote before continuing.",
      });
      return;
    }
  } else {
    if (parsed.data.quoteToken) {
      res.status(400).json({ error: "Direct CELO amounts do not use a USD quote." });
      return;
    }
    try {
      celoTargetAmount = validateDirectCeloAmount(parsed.data.celoTargetAmount!);
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : "Enter a valid CELO amount.",
      });
      return;
    }
  }

  const [campaign] = await db
    .insert(campaignsTable)
    .values({
      name: parsed.data.name,
      brief: parsed.data.brief ?? "",
      pool: usdTargetAmount ? Number(usdTargetAmount) : 0,
      celoTargetAmount,
      usdTargetAmount,
      celoUsdRate,
      cycle: parsed.data.cycle,
      rewardAsset: "CELO",
      chainId: selectedCeloChainId(),
      requireIdentity: false,
    })
    .returning();

  res.status(201).json(
    CreateCampaignResponse.parse(serializeCampaign(campaign, [])),
  );
});

router.post("/campaigns/:campaignId/funding-quote", requireAdmin, async (req, res): Promise<void> => {
  const parsed = RefreshCampaignFundingQuoteParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid campaign id." });
    return;
  }
  const campaign = await getCampaignById(parsed.data.campaignId);
  if (!campaign) {
    res.status(404).json({ error: "Campaign not found." });
    return;
  }
  if (campaign.rewardAsset !== "CELO" || campaign.chainId !== selectedCeloChainId() ||
      campaign.rewardStatus !== "draft" || !campaign.usdTargetAmount) {
    res.status(409).json({ error: "This campaign does not have a refreshable USD quote." });
    return;
  }
  try {
    const quote = await getCampaignQuote(campaign.usdTargetAmount);
    const updated = await db.transaction(async (tx) => {
      const [current] = await tx.select().from(campaignsTable)
        .where(eq(campaignsTable.id, campaign.id)).for("update");
      if (!current || current.rewardAsset !== "CELO" || current.chainId !== selectedCeloChainId() ||
          current.rewardStatus !== "draft" || current.usdTargetAmount !== campaign.usdTargetAmount) {
        return null;
      }
      const [saved] = await tx.update(campaignsTable)
        .set({ celoTargetAmount: quote.celoAmount, celoUsdRate: quote.rateUsd })
        .where(eq(campaignsTable.id, campaign.id))
        .returning();
      return saved;
    });
    if (!updated) {
      res.status(409).json({ error: "Campaign changed before the quote could be refreshed." });
      return;
    }
    res.json(RefreshCampaignFundingQuoteResponse.parse(quote));
  } catch (error) {
    if (error instanceof CeloPriceUnavailableError) {
      res.status(503).json({ error: error.message });
      return;
    }
    res.status(400).json({
      error: error instanceof Error ? error.message : "Could not refresh the CELO quote.",
    });
  }
});

router.get("/campaigns/:campaignId", async (req, res): Promise<void> => {
  const params = GetCampaignParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid campaign id" });
    return;
  }

  await ensureSeeded();
  const campaign = await getCampaignById(params.data.campaignId);
  if (!campaign) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }

  const submissions = await getSubmissions(campaign.id);
  let liveCampaign;
  try { liveCampaign = await hydrateCeloBalances(campaign); }
  catch { res.status(503).json({ error: "Confirmed CELO balances could not be read from the blockchain." }); return; }
  res.json(
    GetCampaignResponse.parse({
      ...serializeCampaign(liveCampaign, submissions),
      submissions,
    }),
  );
});

router.post(
  "/campaigns/:campaignId/submissions",
  async (req, res): Promise<void> => {
    const params = CreateSubmissionParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid campaign id" });
      return;
    }

    const parsed = CreateSubmissionBody.safeParse(cleanObject(req.body));
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid submission input" });
      return;
    }

    if (!isPositiveSafeInteger(params.data.campaignId)) {
      res.status(400).json({ error: "Invalid campaign id" });
      return;
    }
    if (!isValidHttpLinkForPlatform(parsed.data.link, parsed.data.platform)) {
      res.status(400).json({ error: "The link must be an HTTP(S) URL for the selected platform" });
      return;
    }
    const walletAddress = normalizeNonzeroWalletAddress(parsed.data.walletAddress);
    if (!walletAddress) {
      res.status(400).json({ error: "A valid non-zero wallet address is required" });
      return;
    }

    await ensureSeeded();
    const campaign = await getCampaignById(params.data.campaignId);
    if (!campaign) {
      res.status(404).json({ error: "Campaign not found" });
      return;
    }
    if (!submissionsAreOpen(campaign.rewardStatus as
      | "draft"
      | "funded"
      | "swapped"
      | "root-published"
      | "claiming"
      | "closed")) {
      res.status(409).json({ error: "Submissions are closed for this campaign" });
      return;
    }
    const trust = accountTrust[parsed.data.accountAge];
    const engagement = simulatedEngagement(
      `${campaign.id}:${parsed.data.handle}:${parsed.data.link}`,
    );
    const xp = Math.round(
      (engagement.likes + engagement.reposts * 3 + engagement.replies * 2) *
        trust,
    );
    const submission = await db.transaction(async (tx) => {
      const [lockedCampaign] = await tx
        .select({ rewardStatus: campaignsTable.rewardStatus })
        .from(campaignsTable)
        .where(eq(campaignsTable.id, campaign.id))
        .for("update");
      if (
        !lockedCampaign ||
        lockedCampaign.rewardStatus !== "draft"
      ) {
        return null;
      }
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`${campaign.id}:${parsed.data.link}`}, 0))`,
      );
      const [duplicate] = await tx
        .select({ id: submissionsTable.id })
        .from(submissionsTable)
        .where(
          and(
            eq(submissionsTable.campaignId, campaign.id),
            eq(submissionsTable.link, parsed.data.link),
          ),
        )
        .limit(1);
      if (duplicate) return null;

      const [savedSubmission] = await tx
        .insert(submissionsTable)
        .values({
          campaignId: campaign.id,
          handle: parsed.data.handle,
          platform: parsed.data.platform,
          link: parsed.data.link,
          walletAddress,
          accountAge: parsed.data.accountAge,
          ...engagement,
          trust,
          xp,
        })
        .returning();
      return savedSubmission;
    });
    if (!submission) {
      res.status(409).json({ error: "This post has already been submitted" });
      return;
    }
    res.status(201).json(CreateSubmissionResponse.parse(submission));
  },
);

router.get(
  "/campaigns/:campaignId/leaderboard",
  async (req, res): Promise<void> => {
    const params = GetCampaignLeaderboardParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid campaign id" });
      return;
    }

    await ensureSeeded();
    const campaign = await getCampaignById(params.data.campaignId);
    if (!campaign) {
      res.status(404).json({ error: "Campaign not found" });
      return;
    }

    const submissions = await getSubmissions(campaign.id);
    res.json(
      GetCampaignLeaderboardResponse.parse(
        await leaderboardFor(campaign, submissions),
      ),
    );
  },
);

function rewardInputs(submissions: Submission[]) {
  return submissions.map((submission) => ({
    walletAddress:
      normalizeNonzeroWalletAddress(submission.walletAddress ?? "") ?? "",
    handle: submission.handle,
    xp: submission.xp,
  }));
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; cause?: unknown };
  if (candidate.code === "23505") return true;
  return Boolean(
    candidate.cause &&
      typeof candidate.cause === "object" &&
      "code" in candidate.cause &&
      candidate.cause.code === "23505",
  );
}

async function distributionForCampaign(campaign: Campaign) {
  if (campaign.onchainCampaignId === null) {
    throw new Error("Record the onchain campaign funding before building a root");
  }

  const submissions = await getSubmissions(campaign.id);
  const eligibilityError = rewardEligibilityError(submissions);
  if (eligibilityError) throw new Error(eligibilityError);
  return buildRewardDistribution(
    campaign.onchainCampaignId,
    campaign.gdPoolRaw,
    rewardInputs(submissions),
  );
}

router.post(
  "/campaigns/:campaignId/reward-pool/funding",
  requireAdmin,
  async (req, res): Promise<void> => {
    if (!await isRewardPoolDeploymentReady()) {
      res.status(503).json({ error: "Onchain verification is not configured" });
      return;
    }
    const params = RecordRewardPoolFundingParams.safeParse(req.params);
    const parsed = RecordRewardPoolFundingBody.safeParse(cleanObject(req.body));
    if (!params.success || !parsed.success ||
        !isPositiveSafeInteger(params.data.campaignId) ||
        !/^(0|[1-9][0-9]*)$/.test(parsed.data.ethFundedRaw) ||
        !Number.isSafeInteger(parsed.data.onchainCampaignId) ||
        parsed.data.onchainCampaignId < 0) {
      res.status(400).json({ error: "Invalid reward pool funding data" });
      return;
    }

    const campaign = await getCampaignById(params.data.campaignId);
    if (!campaign) {
      res.status(404).json({ error: "Campaign not found" });
      return;
    }
    if (
      campaign.rewardStatus === "funded" &&
      campaign.fundingTxHash?.toLowerCase() === parsed.data.txHash.toLowerCase() &&
      campaign.onchainCampaignId === parsed.data.onchainCampaignId &&
      campaign.contractAddress?.toLowerCase() === parsed.data.contractAddress.toLowerCase() &&
      campaign.projectWallet?.toLowerCase() === parsed.data.projectWallet.toLowerCase() &&
      campaign.ethFundedRaw === parsed.data.ethFundedRaw
    ) {
      res.json(
        RecordRewardPoolFundingResponse.parse(
          serializeCampaign(campaign, await getSubmissions(campaign.id)),
        ),
      );
      return;
    }
    const fundingSubmissions = await getSubmissions(campaign.id);
    const eligibility = getFundingEligibility(
      campaign,
      fundingSubmissions,
      await isRewardPoolDeploymentReady(),
    );
    if (!eligibility.eligible) {
      res.status(409).json({ error: eligibility.reason });
      return;
    }
    if (
      !REWARD_POOL_CONTRACT_ADDRESS ||
      parsed.data.contractAddress.toLowerCase() !== REWARD_POOL_CONTRACT_ADDRESS.toLowerCase()
    ) {
      res.status(409).json({ error: "Campaign funding is unavailable in its current state." });
      return;
    }
    try {
      await verifyFunding({
        ...parsed.data,
        txHash: parsed.data.txHash,
        contractAddress: parsed.data.contractAddress,
        requireIdentity: true,
      });
    } catch {
      res.status(
        !isRewardVerificationConfigured() ? 503 : 400,
      ).json({
        error: !isRewardVerificationConfigured()
          ? "Onchain verification is not configured"
          : "Funding transaction could not be verified",
      });
      return;
    }

    let updatedCampaign: Campaign | undefined;
    try {
      updatedCampaign = await db.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(campaignsTable)
          .where(eq(campaignsTable.id, campaign.id))
          .for("update");
        if (
          current?.rewardStatus === "funded" &&
          current.fundingTxHash?.toLowerCase() === parsed.data.txHash.toLowerCase() &&
          current.onchainCampaignId === parsed.data.onchainCampaignId &&
          current.contractAddress?.toLowerCase() === parsed.data.contractAddress.toLowerCase() &&
          current.projectWallet?.toLowerCase() === parsed.data.projectWallet.toLowerCase() &&
          current.ethFundedRaw === parsed.data.ethFundedRaw
        ) {
          return current;
        }
        if (
          !current ||
          !rewardSnapshotMatches(current, campaign) ||
          current.rewardStatus !== "draft" ||
          current.onchainCampaignId !== null ||
          current.contractAddress !== null ||
          current.projectWallet !== null ||
          !current.requireIdentity
        ) {
          return undefined;
        }
        const [updated] = await tx
          .update(campaignsTable)
          .set({
            chainId: REWARD_POOL_CHAIN_ID,
            contractAddress: normalizeRewardContractAddress(parsed.data.contractAddress),
            projectWallet: parsed.data.projectWallet,
            onchainCampaignId: parsed.data.onchainCampaignId,
            ethFundedRaw: parsed.data.ethFundedRaw,
            requireIdentity: true,
            claimDeadline: null,
            fundingTxHash: parsed.data.txHash,
            rewardStatus: "funded",
          })
          .where(
            and(
              eq(campaignsTable.id, campaign.id),
              eq(campaignsTable.rewardStatus, "draft"),
            ),
          )
          .returning();
        return updated;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        res.status(409).json({ error: "That onchain campaign is already bound to another campaign" });
        return;
      }
      throw error;
    }
    if (!updatedCampaign) {
      res.status(409).json({ error: "Campaign changed while funding was being verified" });
      return;
    }

    const submissions = await getSubmissions(campaign.id);
    res.json(
      RecordRewardPoolFundingResponse.parse(
        serializeCampaign(updatedCampaign, submissions),
      ),
    );
  },
);

router.post(
  "/campaigns/:campaignId/reward-pool/swap",
  requireAdmin,
  async (req, res): Promise<void> => {
    if (!isRewardVerificationConfigured()) {
      res.status(503).json({ error: "Onchain verification is not configured" });
      return;
    }
    const params = RecordRewardPoolSwapParams.safeParse(req.params);
    const parsed = RecordRewardPoolSwapBody.safeParse(cleanObject(req.body));
    if (!params.success || !parsed.success ||
        !isPositiveSafeInteger(params.data.campaignId) ||
        !/^(0|[1-9][0-9]*)$/.test(parsed.data.gdPoolRaw)) {
      res.status(400).json({ error: "Invalid reward pool swap data" });
      return;
    }

    const campaign = await getCampaignById(params.data.campaignId);
    if (!campaign) {
      res.status(404).json({ error: "Campaign not found" });
      return;
    }
    if (
      campaign.rewardStatus === "swapped" &&
      campaign.swapTxHash?.toLowerCase() === parsed.data.txHash.toLowerCase() &&
      campaign.gdPoolRaw === parsed.data.gdPoolRaw
    ) {
      res.json(
        RecordRewardPoolSwapResponse.parse(
          serializeCampaign(campaign, await getSubmissions(campaign.id)),
        ),
      );
      return;
    }
    if (
      campaign.rewardStatus !== "funded" ||
      campaign.onchainCampaignId === null ||
      !campaign.contractAddress ||
      campaign.contractAddress.toLowerCase() !== REWARD_POOL_CONTRACT_ADDRESS?.toLowerCase()
    ) {
      res.status(409).json({ error: "Campaign is not ready to record a swap" });
      return;
    }
    try {
      await verifySwap({
        ...parsed.data,
        contractAddress: campaign.contractAddress,
        onchainCampaignId: campaign.onchainCampaignId,
        ethFundedRaw: campaign.ethFundedRaw,
        projectWallet: campaign.projectWallet ?? "",
      });
    } catch {
      res.status(
        !isRewardVerificationConfigured() ? 503 : 400,
      ).json({
        error: !isRewardVerificationConfigured()
          ? "Onchain verification is not configured"
          : "Swap transaction could not be verified",
      });
      return;
    }

    const updatedCampaign = await db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(campaignsTable)
        .where(eq(campaignsTable.id, campaign.id))
        .for("update");
      if (
        current?.rewardStatus === "swapped" &&
        current.swapTxHash?.toLowerCase() === parsed.data.txHash.toLowerCase() &&
        current.gdPoolRaw === parsed.data.gdPoolRaw
      ) {
        return current;
      }
      if (
        !current ||
        !rewardSnapshotMatches(current, campaign) ||
        current.rewardStatus !== "funded"
      ) {
        return undefined;
      }
      const [updated] = await tx
        .update(campaignsTable)
        .set({
          gdPoolRaw: parsed.data.gdPoolRaw,
          swapTxHash: parsed.data.txHash,
          rewardStatus: "swapped",
        })
        .where(
          and(
            eq(campaignsTable.id, campaign.id),
            eq(campaignsTable.rewardStatus, "funded"),
            eq(campaignsTable.onchainCampaignId, campaign.onchainCampaignId!),
            eq(campaignsTable.contractAddress, campaign.contractAddress!),
            eq(campaignsTable.ethFundedRaw, campaign.ethFundedRaw),
          ),
        )
        .returning();
      return updated;
    });
    if (!updatedCampaign) {
      res.status(409).json({ error: "Campaign changed while swap was being verified" });
      return;
    }

    const submissions = await getSubmissions(campaign.id);
    res.json(
      RecordRewardPoolSwapResponse.parse(
        serializeCampaign(updatedCampaign, submissions),
      ),
    );
  },
);

router.get(
  "/campaigns/:campaignId/reward-pool/distribution",
  async (req, res): Promise<void> => {
    const params = GetRewardPoolDistributionParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid campaign id" });
      return;
    }

    const campaign = await getCampaignById(params.data.campaignId);
    if (!campaign) {
      res.status(404).json({ error: "Campaign not found" });
      return;
    }
    const eligibilityError = rewardEligibilityError(
      await getSubmissions(campaign.id),
    );
    if (eligibilityError) {
      res.status(409).json({ error: eligibilityError });
      return;
    }

    try {
      const distribution = await distributionForCampaign(campaign);
      res.json(
        GetRewardPoolDistributionResponse.parse({
          campaignId: campaign.id,
          onchainCampaignId: campaign.onchainCampaignId,
          gdPoolRaw: campaign.gdPoolRaw,
          totalAllocatedRaw: distribution.totalAllocatedRaw,
          merkleRoot: distribution.root,
          leaves: distribution.leaves,
        }),
      );
    } catch {
      res.status(400).json({ error: "Unable to build distribution" });
    }
  },
);

router.get(
  "/campaigns/:campaignId/reward-pool/eligibility",
  async (req, res): Promise<void> => {
    const params = GetRewardPoolEligibilityParams.safeParse(req.params);
    if (!params.success || !isPositiveSafeInteger(params.data.campaignId)) {
      res.status(400).json({ error: "Invalid campaign id" });
      return;
    }

    const campaign = await getCampaignById(params.data.campaignId);
    if (!campaign) {
      res.status(404).json({ error: "Campaign not found" });
      return;
    }
    const eligibility = getFundingEligibility(
      campaign,
      await getSubmissions(campaign.id),
      await isRewardPoolDeploymentReady(),
    );
    res.json(GetRewardPoolEligibilityResponse.parse(eligibility));
  },
);

router.post(
  "/campaigns/:campaignId/reward-pool/root",
  requireAdmin,
  async (req, res): Promise<void> => {
    if (!isRewardVerificationConfigured()) {
      res.status(503).json({ error: "Onchain verification is not configured" });
      return;
    }
    const params = RecordRewardPoolRootParams.safeParse(req.params);
    const parsed = RecordRewardPoolRootBody.safeParse(cleanObject(req.body));
    if (!params.success || !parsed.success ||
        !isPositiveSafeInteger(params.data.campaignId)) {
      res.status(400).json({ error: "Invalid Merkle root data" });
      return;
    }

    const campaign = await getCampaignById(params.data.campaignId);
    if (!campaign) {
      res.status(404).json({ error: "Campaign not found" });
      return;
    }
    if (
      campaign.rewardStatus === "root-published" &&
      campaign.rootTxHash?.toLowerCase() === parsed.data.txHash.toLowerCase() &&
      campaign.merkleRoot?.toLowerCase() === parsed.data.merkleRoot.toLowerCase()
    ) {
      res.json(
        RecordRewardPoolRootResponse.parse(
          serializeCampaign(campaign, await getSubmissions(campaign.id)),
        ),
      );
      return;
    }
    if (
      campaign.rewardStatus !== "swapped" ||
      campaign.onchainCampaignId === null ||
      !campaign.contractAddress ||
      campaign.contractAddress.toLowerCase() !== REWARD_POOL_CONTRACT_ADDRESS?.toLowerCase()
    ) {
      res.status(409).json({ error: "Root publishing is unavailable in this campaign state" });
      return;
    }
    const eligibilityError = rewardEligibilityError(
      await getSubmissions(campaign.id),
    );
    if (eligibilityError) {
      res.status(409).json({ error: eligibilityError });
      return;
    }

    try {
      const distribution = await distributionForCampaign(campaign);
      if (distribution.root.toLowerCase() !== parsed.data.merkleRoot.toLowerCase()) {
        res.status(400).json({ error: "Merkle root does not match current XP shares" });
        return;
      }
      const claimDeadline = await verifyRoot({
        ...parsed.data,
        contractAddress: campaign.contractAddress,
        onchainCampaignId: campaign.onchainCampaignId,
        gdPoolRaw: campaign.gdPoolRaw,
        projectWallet: campaign.projectWallet ?? "",
      });

      const updatedCampaign = await db.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(campaignsTable)
          .where(eq(campaignsTable.id, campaign.id))
          .for("update");
        if (
          current?.rewardStatus === "root-published" &&
          current.rootTxHash?.toLowerCase() === parsed.data.txHash.toLowerCase() &&
          current.merkleRoot?.toLowerCase() === parsed.data.merkleRoot.toLowerCase()
        ) {
          return current;
        }
        if (
          !current ||
          !rewardSnapshotMatches(current, campaign) ||
          current.rewardStatus !== "swapped"
        ) {
          return undefined;
        }
        const [updated] = await tx
          .update(campaignsTable)
          .set({
            merkleRoot: parsed.data.merkleRoot,
            rootTxHash: parsed.data.txHash,
            claimDeadline,
            rewardStatus: "root-published",
          })
          .where(
            and(
              eq(campaignsTable.id, campaign.id),
              eq(campaignsTable.rewardStatus, "swapped"),
              eq(campaignsTable.onchainCampaignId, campaign.onchainCampaignId!),
              eq(campaignsTable.contractAddress, campaign.contractAddress!),
              eq(campaignsTable.gdPoolRaw, campaign.gdPoolRaw),
            ),
          )
          .returning();
        return updated;
      });
      if (!updatedCampaign) {
        res.status(409).json({ error: "Campaign changed while root was being verified" });
        return;
      }
      const submissions = await getSubmissions(campaign.id);
      res.json(
        RecordRewardPoolRootResponse.parse(
          serializeCampaign(updatedCampaign, submissions),
        ),
      );
    } catch {
      res.status(
        !isRewardVerificationConfigured() ? 503 : 400,
      ).json({
        error: !isRewardVerificationConfigured()
          ? "Onchain verification is not configured"
          : "Unable to verify the published root",
      });
    }
  },
);

router.get(
  "/campaigns/:campaignId/reward-pool/claim/:walletAddress",
  async (req, res): Promise<void> => {
    const params = GetRewardPoolClaimParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid campaign or wallet address" });
      return;
    }
    const campaign = await getCampaignById(params.data.campaignId);
    if (!campaign) {
      res.status(404).json({ error: "Campaign not found" });
      return;
    }
    if (
      campaign.onchainCampaignId === null ||
      !campaign.merkleRoot ||
      campaign.rewardStatus === "closed" ||
      !campaign.claimDeadline ||
      campaign.claimDeadline.getTime() <= Date.now()
    ) {
      res.status(400).json({ error: "The campaign root has not been published" });
      return;
    }

    try {
      if (!await isRewardPoolDeploymentReady()) {
        res.status(503).json({ error: "Onchain claim verification is not configured" });
        return;
      }
      if (await isRewardClaimed(campaign.onchainCampaignId, params.data.walletAddress)) {
        res.status(409).json({ error: "This wallet already claimed its G$ allocation" });
        return;
      }
      const submissions = await getSubmissions(campaign.id);
      const claim = getRewardClaim(
        campaign.onchainCampaignId,
        campaign.gdPoolRaw,
        campaign.merkleRoot,
        rewardInputs(submissions),
        params.data.walletAddress,
      );
      res.json(
        GetRewardPoolClaimResponse.parse({
          campaignId: campaign.id,
          onchainCampaignId: campaign.onchainCampaignId,
          ...claim,
        }),
      );
    } catch {
      res.status(404).json({ error: "No claim found" });
    }
  },
);

router.post(
  "/campaigns/:campaignId/reward-pool/claim",
  async (req, res): Promise<void> => {
    if (!isRewardVerificationConfigured()) {
      res.status(503).json({ error: "Onchain verification is not configured" });
      return;
    }
    const params = RecordRewardPoolClaimParams.safeParse(req.params);
    const parsed = RecordRewardPoolClaimBody.safeParse(cleanObject(req.body));
    if (!params.success || !parsed.success ||
        !isPositiveSafeInteger(params.data.campaignId) ||
        !/^(0|[1-9][0-9]*)$/.test(parsed.data.amountRaw) ||
        !isValidNonzeroWalletAddress(parsed.data.walletAddress)) {
      res.status(400).json({ error: "Invalid claim data" });
      return;
    }
    const campaign = await getCampaignById(params.data.campaignId);
    if (!campaign) {
      res.status(404).json({ error: "Campaign not found" });
      return;
    }
    if (
      campaign.onchainCampaignId === null ||
      !campaign.merkleRoot ||
      !campaign.contractAddress ||
      !["root-published", "claiming", "closed"].includes(campaign.rewardStatus)
    ) {
      res.status(400).json({ error: "The campaign root has not been published" });
      return;
    }

    let claim: ReturnType<typeof getRewardClaim>;
    let verifiedClaim: Awaited<ReturnType<typeof verifyClaim>>;
    try {
      const submissions = await getSubmissions(campaign.id);
      claim = getRewardClaim(
        campaign.onchainCampaignId,
        campaign.gdPoolRaw,
        campaign.merkleRoot,
        rewardInputs(submissions),
        parsed.data.walletAddress,
      );
      if (claim.amountRaw !== parsed.data.amountRaw) {
        res.status(400).json({ error: "Claim amount does not match the published root" });
        return;
      }
      verifiedClaim = await verifyClaim({
        ...parsed.data,
        contractAddress: campaign.contractAddress,
        onchainCampaignId: campaign.onchainCampaignId,
        merkleRoot: campaign.merkleRoot,
      });
    } catch {
      res.status(
        !isRewardVerificationConfigured() ? 503 : 400,
      ).json({
        error: !isRewardVerificationConfigured()
          ? "Onchain verification is not configured"
          : "Claim transaction could not be verified",
      });
      return;
    }

    const recorded = await db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(campaignsTable)
        .where(eq(campaignsTable.id, campaign.id))
        .for("update");
      if (!current) return false;
      const nextStatus = claimStatusForBoundCampaign(
        current,
        campaign,
        verifiedClaim.fullyClaimed,
      );
      if (!nextStatus) return false;
      if (nextStatus === current.rewardStatus) return true;
      const [updated] = await tx
        .update(campaignsTable)
        .set({ rewardStatus: nextStatus })
        .where(
          and(
            eq(campaignsTable.id, campaign.id),
            eq(campaignsTable.rewardStatus, current.rewardStatus),
          ),
        )
        .returning({ id: campaignsTable.id });
      return Boolean(updated);
    });
    if (!recorded) {
      res.status(409).json({ error: "Campaign changed while the claim was being recorded" });
      return;
    }

    res.json(
      RecordRewardPoolClaimResponse.parse({
        campaignId: campaign.id,
        onchainCampaignId: campaign.onchainCampaignId,
        ...claim,
      }),
    );
  },
);

router.post(
  "/campaigns/:campaignId/reward-pool/refund",
  requireAdmin,
  async (req, res): Promise<void> => {
    if (!isRewardVerificationConfigured()) {
      res.status(503).json({ error: "Onchain verification is not configured" });
      return;
    }
    const params = RecordRewardPoolRefundParams.safeParse(req.params);
    const parsed = RecordRewardPoolRefundBody.safeParse(cleanObject(req.body));
    if (!params.success || !parsed.success ||
        !isPositiveSafeInteger(params.data.campaignId)) {
      res.status(400).json({ error: "Invalid reward pool refund data" });
      return;
    }

    const campaign = await getCampaignById(params.data.campaignId);
    if (!campaign) {
      res.status(404).json({ error: "Campaign not found" });
      return;
    }
    if (
      campaign.onchainCampaignId === null ||
      !campaign.projectWallet ||
      !campaign.contractAddress ||
      campaign.contractAddress.toLowerCase() !== REWARD_POOL_CONTRACT_ADDRESS?.toLowerCase() ||
      (!canRecordVerifiedRefund(campaign.rewardStatus) &&
        campaign.rewardStatus !== "closed")
    ) {
      res.status(409).json({ error: "Campaign is not eligible for an expired refund" });
      return;
    }

    try {
      await verifyRefund({
        ...parsed.data,
        txHash: parsed.data.txHash,
        contractAddress: parsed.data.contractAddress,
        onchainCampaignId: campaign.onchainCampaignId,
        projectWallet: campaign.projectWallet,
        gdPoolRaw: campaign.gdPoolRaw,
      });
    } catch {
      res.status(
        !isRewardVerificationConfigured() ? 503 : 400,
      ).json({
        error: !isRewardVerificationConfigured()
          ? "Onchain verification is not configured"
          : "Refund transaction could not be verified",
      });
      return;
    }

    const updatedCampaign = await db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(campaignsTable)
        .where(eq(campaignsTable.id, campaign.id))
        .for("update");
      if (!current) {
        return undefined;
      }
      const nextStatus = refundStatusForBoundCampaign(current, campaign);
      if (!nextStatus) return undefined;
      const [updated] = await tx
        .update(campaignsTable)
        .set({
          rewardStatus: nextStatus,
        })
        .where(
          and(
            eq(campaignsTable.id, campaign.id),
            eq(campaignsTable.rewardStatus, current.rewardStatus),
          ),
        )
        .returning();
      return updated;
    });
    if (!updatedCampaign) {
      res.status(409).json({ error: "Campaign changed while the refund was being verified" });
      return;
    }

    res.json(
      RecordRewardPoolRefundResponse.parse(
        serializeCampaign(updatedCampaign, await getSubmissions(campaign.id)),
      ),
    );
  },
);

export default router;