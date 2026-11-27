import { isPrivyUserId, verifyPrivyAccessToken } from "../privy-auth";
import type { NextFunction, Request, Response } from "express";
import sanitizeHtml from "sanitize-html";

export {
  isValidNonzeroWalletAddress,
  normalizeNonzeroWalletAddress,
} from "../reward-eligibility";

type AuthenticatedRequest = Request & { userId?: string };

export function cleanText(value: unknown): unknown {
  return typeof value === "string"
    ? sanitizeHtml(value, { allowedTags: [], allowedAttributes: {} }).trim()
    : value;
}

export function cleanObject(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, cleanText(item)]),
  );
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const token = req.headers.authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const appId = process.env.PRIVY_APP_ID;
  if (!appId) {
    res.status(503).json({ error: "Privy authentication is not configured" });
    return;
  }
  try {
    const userId = await verifyPrivyAccessToken(token, appId);
    (req as AuthenticatedRequest).userId = userId;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired Privy session" });
  }
}

export function getConfiguredAdminIds(): Set<string> {
  return new Set(
    (process.env.PRIVY_ADMIN_USER_IDS ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(isPrivyUserId),
  );
}

export function isAdminUser(userId: string): boolean {
  return getConfiguredAdminIds().has(userId);
}

export function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const userId = (req as AuthenticatedRequest).userId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (!isAdminUser(userId)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  next();
}

export function isPositiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

export function isValidHttpLinkForPlatform(
  value: string,
  platform: string,
): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    if (url.username || url.password || !url.hostname) return false;
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const isPlatformHost = (domain: string) =>
      host === domain || host.endsWith(`.${domain}`);
    if (platform === "X (Twitter)") {
      return isPlatformHost("x.com") || isPlatformHost("twitter.com");
    }
    if (platform === "TikTok") return isPlatformHost("tiktok.com");
    if (platform === "Medium") return isPlatformHost("medium.com");
    return false;
  } catch {
    return false;
  }
}

export function isValidWalletAddress(value: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}
