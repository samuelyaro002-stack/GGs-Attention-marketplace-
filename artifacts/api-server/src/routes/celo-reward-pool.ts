import { Router, type IRouter, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { db, campaignsTable, submissionsTable, type Campaign } from "@workspace/db";
import {
  GetCeloRewardPoolConfigResponse, GetCeloRewardPoolEligibilityResponse,
  GetCeloAdminCampaignsResponse, RecordCeloBatchPayoutBody, RecordCeloBatchPayoutResponse,
  RecordCeloRewardPoolFundingBody, RecordCeloRewardPoolFundingResponse,
  RecordCeloRewardPoolRefundBody, RecordCeloRewardPoolRefundResponse,
} from "@workspace/api-zod";
import { serializeCampaign } from "./marketplace";
import { cleanObject, requireAdmin, requireAuth } from "../middlewares/security";
import { rewardEligibilityError } from "../reward-eligibility";
import { selectedCeloChainId, CeloVerificationError } from "../celo-reward-verification";
import {
  payoutPreview, celoConfigV3 as celoConfig, verifyCeloFundingV3, verifyCeloPayout, verifyCeloRefundV3,
} from "../celo-payout";

const router: IRouter = Router();
const base = "/campaigns/:campaignId/celo-reward-pool";

function fail(res: Response, error: unknown) {
  if (error instanceof CeloVerificationError) res.status(error.status).json({ error: error.message });
  else {
    res.status(503).json({ error: "The selected Celo network transaction or contract state could not be checked. Retry later; never send another transaction just to sync." });
  }
}
function conflict(condition: unknown, message: string): asserts condition {
  if (!condition) throw new CeloVerificationError(message, 409);
}
async function campaignFor(req: Request): Promise<Campaign> {
  const id = Number(req.params.campaignId);
  if (!Number.isSafeInteger(id) || id <= 0) throw new CeloVerificationError("Invalid campaign id");
  const [campaign] = await db.select().from(campaignsTable).where(eq(campaignsTable.id, id));
  if (!campaign) throw new CeloVerificationError("Campaign not found", 404);
  conflict(campaign.rewardAsset === "CELO" && campaign.chainId === selectedCeloChainId(),
    "This endpoint only supports CELO campaigns on the selected Celo network");
  return campaign;
}
async function submissionsFor(campaign: Campaign) {
  return db.select().from(submissionsTable).where(eq(submissionsTable.campaignId, campaign.id));
}
const fundingState = (campaign: Campaign) =>
  campaign.rewardStatus === "draft" && !campaign.contractAddress &&
  campaign.onchainCampaignId === null && !campaign.projectWallet && !campaign.requireIdentity;

router.get("/celo-reward-pool/config", async (_req, res): Promise<void> => {
  res.json(GetCeloRewardPoolConfigResponse.parse(await celoConfig()));
});
router.get("/celo-reward-pool/admin/campaigns", requireAuth, requireAdmin, async (_req, res): Promise<void> => {
  try {
    const campaigns = await db.select().from(campaignsTable).where(eq(campaignsTable.rewardAsset, "CELO"));
    const result = await Promise.all(campaigns.map(async campaign =>
      payoutPreview(campaign, await submissionsFor(campaign))));
    res.json(GetCeloAdminCampaignsResponse.parse(result));
  } catch (error) { fail(res, error); }
});
router.get(`${base}/eligibility`, async (req, res): Promise<void> => {
  try {
    const campaign = await campaignFor(req);
    const config = await celoConfig();
    const reason = !fundingState(campaign) ? "CELO campaign is no longer a funding draft."
      : !config.ready ? config.reason : rewardEligibilityError(await submissionsFor(campaign));
    res.json(GetCeloRewardPoolEligibilityResponse.parse({ eligible: reason === null, reason }));
  } catch (error) { fail(res, error); }
});
router.post(`${base}/funding`, requireAuth, requireAdmin, async (req, res): Promise<void> => {
  try {
    const parsed = RecordCeloRewardPoolFundingBody.safeParse(cleanObject(req.body));
    if (!parsed.success) throw new CeloVerificationError("Invalid CELO funding input");
    const found = await campaignFor(req);
    const campaign = await db.transaction(async tx => {
      const [current] = await tx.select().from(campaignsTable)
        .where(eq(campaignsTable.id, found.id)).for("update");
      conflict(current?.rewardAsset === "CELO", "Campaign changed");
      if (current.fundingTxHash?.toLowerCase() === parsed.data.txHash.toLowerCase() &&
          current.onchainCampaignId === parsed.data.onchainCampaignId) return current;
      conflict(fundingState(current), "CELO campaign already funded or changed");
      const submissions = await tx.select().from(submissionsTable)
        .where(eq(submissionsTable.campaignId, current.id));
      conflict(!rewardEligibilityError(submissions), rewardEligibilityError(submissions) ?? "");
      const verified = await verifyCeloFundingV3(parsed.data.txHash, parsed.data.onchainCampaignId);
      const [updated] = await tx.update(campaignsTable).set(verified)
        .where(eq(campaignsTable.id, current.id)).returning();
      return updated;
    });
    res.json(RecordCeloRewardPoolFundingResponse.parse(
      serializeCampaign(campaign, await submissionsFor(campaign))));
  } catch (error) {
    const code = (error as { code?: string; cause?: { code?: string } })?.cause?.code ??
      (error as { code?: string })?.code;
    if (code === "23505") res.status(409).json({ error: "That on-chain campaign is already bound to another campaign" });
    else fail(res, error);
  }
});
router.post(`${base}/payout`, requireAuth, requireAdmin, async (req, res): Promise<void> => {
  try {
    const parsed = RecordCeloBatchPayoutBody.safeParse(cleanObject(req.body));
    if (!parsed.success) throw new CeloVerificationError("Invalid payout transaction hash");
    const found = await campaignFor(req);
    const preview = await db.transaction(async tx => {
      const [current] = await tx.select().from(campaignsTable)
        .where(eq(campaignsTable.id, found.id)).for("update");
      conflict(current && current.rewardAsset === "CELO" &&
        current.onchainCampaignId !== null && current.contractAddress &&
        ["funded", "distributing", "paid"].includes(current.rewardStatus),
        "Campaign is not bound to an active CELO pool");
      const submissions = await tx.select().from(submissionsTable)
        .where(eq(submissionsTable.campaignId, current.id));
      await verifyCeloPayout(current, submissions, parsed.data.txHash);
      const preview = await payoutPreview(current, submissions);
      const status = preview.remainingRaw === "0" && preview.submissions.every(s => s.paid)
        ? "paid" : "distributing";
      await tx.update(campaignsTable).set({ rewardStatus: status })
        .where(eq(campaignsTable.id, current.id));
      return { ...preview, rewardStatus: status };
    });
    res.json(RecordCeloBatchPayoutResponse.parse(preview));
  } catch (error) { fail(res, error); }
});
router.post(`${base}/refund`, requireAuth, requireAdmin, async (req, res): Promise<void> => {
  try {
    const parsed = RecordCeloRewardPoolRefundBody.safeParse(cleanObject(req.body));
    if (!parsed.success) throw new CeloVerificationError("Invalid withdrawal input");
    const found = await campaignFor(req);
    const campaign = await db.transaction(async tx => {
      const [current] = await tx.select().from(campaignsTable)
        .where(eq(campaignsTable.id, found.id)).for("update");
      conflict(current?.rewardAsset === "CELO" && current.onchainCampaignId !== null,
        "CELO pool is not funded");
      await verifyCeloRefundV3(current, parsed.data.txHash);
      const [updated] = await tx.update(campaignsTable).set({ rewardStatus: "closed" })
        .where(eq(campaignsTable.id, current.id)).returning();
      return updated;
    });
    res.json(RecordCeloRewardPoolRefundResponse.parse(
      serializeCampaign(campaign, await submissionsFor(campaign))));
  } catch (error) { fail(res, error); }
});
// Removed v2 root/claim endpoints must fail explicitly, not imply that creator self-claim still works.
router.all(`${base}/distribution`, (_req, res) => { res.status(410).json({ error: "CELO now uses admin-run batch payouts." }); });
router.all(`${base}/root`, (_req, res) => { res.status(410).json({ error: "Root publishing was removed from the CELO contract." }); });
router.all(`${base}/claim`, (_req, res) => { res.status(410).json({ error: "CELO now uses admin-run batch payouts." }); });
router.all(`${base}/claim/:walletAddress`, (_req, res) => { res.status(410).json({ error: "CELO now uses admin-run batch payouts." }); });

export default router;
