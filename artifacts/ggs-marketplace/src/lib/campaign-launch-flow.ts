import { parseEther } from 'viem';

export const CAMPAIGN_LAUNCH_DRAFT_KEY = 'ggs:launch-draft:v1';
export const CAMPAIGN_LAUNCH_SIGN_IN_URL = '/sign-in?returnTo=%2Flaunch';
export const CAMPAIGN_LAUNCH_USD_MIN = 10;
export const CAMPAIGN_LAUNCH_USD_MAX = 100_000;
export const CAMPAIGN_LAUNCH_CELO_MIN = '0.1';

export type CampaignLaunchDraft = {
  name: string;
  brief: string;
  usdAmount: string;
  celoAmount: string;
  direct: boolean;
  cycle: '1 week' | '2 weeks' | '4 weeks';
  step: number;
};

export const emptyCampaignLaunchDraft: CampaignLaunchDraft = {
  name: '',
  brief: '',
  usdAmount: '',
  celoAmount: '',
  direct: false,
  cycle: '2 weeks',
  step: 0,
};

type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const isCycle = (value: unknown): value is CampaignLaunchDraft['cycle'] =>
  value === '1 week' || value === '2 weeks' || value === '4 weeks';

export function restoreCampaignLaunchDraft(raw: string | null): CampaignLaunchDraft {
  if (!raw) return { ...emptyCampaignLaunchDraft };
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') return { ...emptyCampaignLaunchDraft };
    const parsed = value as Record<string, unknown>;
    const parsedStep = Number(parsed.step);
    return {
      name: typeof parsed.name === 'string' ? parsed.name : '',
      brief: typeof parsed.brief === 'string' ? parsed.brief : '',
      usdAmount: typeof parsed.usdAmount === 'string' ? parsed.usdAmount : '',
      celoAmount: typeof parsed.celoAmount === 'string' ? parsed.celoAmount : '',
      direct: parsed.direct === true,
      cycle: isCycle(parsed.cycle) ? parsed.cycle : emptyCampaignLaunchDraft.cycle,
      step: Number.isFinite(parsedStep) ? Math.max(0, Math.min(4, Math.trunc(parsedStep))) : 0,
    };
  } catch {
    return { ...emptyCampaignLaunchDraft };
  }
}

export function loadCampaignLaunchDraft(storage: DraftStorage): CampaignLaunchDraft {
  try {
    return restoreCampaignLaunchDraft(storage.getItem(CAMPAIGN_LAUNCH_DRAFT_KEY));
  } catch {
    return { ...emptyCampaignLaunchDraft };
  }
}

export function saveCampaignLaunchDraft(storage: DraftStorage, draft: CampaignLaunchDraft, step: number): void {
  try {
    storage.setItem(CAMPAIGN_LAUNCH_DRAFT_KEY, JSON.stringify({ ...draft, step }));
  } catch {
    // Storage can be unavailable in restricted browser contexts.
  }
}

export function clearCampaignLaunchDraft(storage: DraftStorage): void {
  try {
    storage.removeItem(CAMPAIGN_LAUNCH_DRAFT_KEY);
  } catch {
    // Storage can be unavailable in restricted browser contexts.
  }
}

export function safeAuthReturnPath(value: string | null): string {
  return value?.startsWith('/') && !value.startsWith('//') ? value : '/user-portal';
}

export function isValidCampaignUsdTarget(value: string): boolean {
  return /^(?:0|[1-9]\d{0,5})(?:\.\d{1,2})?$/.test(value) &&
    Number(value) >= CAMPAIGN_LAUNCH_USD_MIN &&
    Number(value) <= CAMPAIGN_LAUNCH_USD_MAX;
}

export function isValidDirectCampaignCeloTarget(value: string): boolean {
  if (!/^(0|[1-9]\d{0,17})(\.\d{1,4})?$/.test(value)) return false;
  try {
    return parseEther(value) >= parseEther(CAMPAIGN_LAUNCH_CELO_MIN);
  } catch {
    return false;
  }
}

export function shouldFetchCampaignUsdQuote(direct: boolean, validUsdTarget: boolean): boolean {
  return !direct && validUsdTarget;
}

export function normalizeCampaignQuoteExpiry(value: number): number {
  return value < 1_000_000_000_000 ? value * 1000 : value;
}

export function isCampaignQuoteExpired(expiresAt: number, now: number): boolean {
  return !expiresAt || normalizeCampaignQuoteExpiry(expiresAt) <= now;
}

export async function requestFreshCampaignQuote<T extends { expiresAt: number }>(
  refetch: () => Promise<{ isError: boolean; data?: T | null }>,
  now = Date.now(),
): Promise<T | null> {
  const result = await refetch();
  if (result.isError || !result.data || isCampaignQuoteExpired(result.data.expiresAt, now)) return null;
  return result.data;
}

export function shouldAutoRefreshCampaignQuote(input: {
  direct: boolean;
  hasQuote: boolean;
  expiresAt: number;
  now: number;
  isFetching: boolean;
  refreshedExpiry: number;
}): boolean {
  const expiry = normalizeCampaignQuoteExpiry(input.expiresAt);
  return !input.direct && input.hasQuote && Boolean(input.expiresAt) &&
    expiry <= input.now && !input.isFetching && input.refreshedExpiry !== expiry;
}
