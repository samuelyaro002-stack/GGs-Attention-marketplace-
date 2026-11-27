import { createInsertSchema } from "drizzle-zod";
import {
  boolean,
  doublePrecision,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { z } from "zod/v4";

export const campaignsTable = pgTable("campaigns", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  brief: text("brief").notNull().default(""),
  pool: doublePrecision("pool").notNull(),
  celoTargetAmount: text("celo_target_amount"),
  usdTargetAmount: text("usd_target_amount"),
  celoUsdRate: text("celo_usd_rate"),
  cycle: text("cycle").notNull(),
  rewardAsset: text("reward_asset").notNull().default("G$"),
  chainId: integer("chain_id").notNull().default(42220),
  contractAddress: text("contract_address"),
  projectWallet: text("project_wallet"),
  onchainCampaignId: integer("onchain_campaign_id"),
  requireIdentity: boolean("require_identity").notNull().default(true),
  ethFundedRaw: text("eth_funded_raw").notNull().default("0"),
  gdPoolRaw: text("gd_pool_raw").notNull().default("0"),
  amountDepositedRaw: text("amount_deposited_raw").notNull().default("0"),
  celoPoolRaw: text("celo_pool_raw").notNull().default("0"),
  protocolFeeRaw: text("protocol_fee_raw").notNull().default("0"),
  merkleRoot: text("merkle_root"),
  rewardStatus: text("reward_status").notNull().default("draft"),
  claimDeadline: timestamp("claim_deadline", { withTimezone: true }),
  fundingTxHash: text("funding_tx_hash"),
  swapTxHash: text("swap_tx_hash"),
  rootTxHash: text("root_tx_hash"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (table) => [
  uniqueIndex("campaigns_onchain_binding_uq")
    .on(
      table.chainId,
      sql`lower(${table.contractAddress})`,
      table.onchainCampaignId,
    )
    .where(
      sql`${table.contractAddress} IS NOT NULL AND ${table.onchainCampaignId} IS NOT NULL`,
    ),
]);

export const insertCampaignSchema = createInsertSchema(campaignsTable).omit({
  id: true,
  createdAt: true,
});

export type InsertCampaign = z.infer<typeof insertCampaignSchema>;
export type Campaign = typeof campaignsTable.$inferSelect;

export const campaignCycleSchema = z.enum(["1 week", "2 weeks", "4 weeks"]);
export const accountAgeSchema = z.enum([
  "under-30-days",
  "1-6-months",
  "established",
]);

export const submissionPlatformSchema = z.enum([
  "X (Twitter)",
  "TikTok",
  "Medium",
]);

export const submissionsTable = pgTable("submissions", {
  id: serial("id").primaryKey(),
  campaignId: integer("campaign_id")
    .notNull()
    .references(() => campaignsTable.id, { onDelete: "cascade" }),
  handle: text("handle").notNull(),
  platform: text("platform").notNull(),
  link: text("link").notNull(),
  walletAddress: text("wallet_address"),
  accountAge: text("account_age").notNull(),
  likes: integer("likes").notNull(),
  reposts: integer("reposts").notNull(),
  replies: integer("replies").notNull(),
  trust: doublePrecision("trust").notNull(),
  xp: integer("xp").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertSubmissionSchema = createInsertSchema(
  submissionsTable,
).omit({
  id: true,
  createdAt: true,
});

export type InsertSubmission = z.infer<typeof insertSubmissionSchema>;
export type Submission = typeof submissionsTable.$inferSelect;