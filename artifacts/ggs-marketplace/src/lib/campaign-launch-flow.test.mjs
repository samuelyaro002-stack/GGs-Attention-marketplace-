import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CAMPAIGN_LAUNCH_DRAFT_KEY,
  CAMPAIGN_LAUNCH_SIGN_IN_URL,
  emptyCampaignLaunchDraft,
  isCampaignQuoteExpired,
  isValidCampaignUsdTarget,
  isValidDirectCampaignCeloTarget,
  loadCampaignLaunchDraft,
  requestFreshCampaignQuote,
  safeAuthReturnPath,
  saveCampaignLaunchDraft,
  shouldAutoRefreshCampaignQuote,
  shouldFetchCampaignUsdQuote,
} from './campaign-launch-flow.ts';

function memoryStorage() {
  const values = new Map();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };
}

test('launch draft survives a reload at the saved step', () => {
  const storage = memoryStorage();
  const draft = {
    name: 'Kora launch',
    brief: 'Introduce the protocol',
    usdAmount: '250',
    celoAmount: '',
    direct: false,
    cycle: '4 weeks',
    step: 0,
  };

  saveCampaignLaunchDraft(storage, draft, 3);

  assert.equal(CAMPAIGN_LAUNCH_DRAFT_KEY, 'ggs:launch-draft:v1');
  assert.deepEqual(loadCampaignLaunchDraft(storage), { ...draft, step: 3 });
});

test('launch requires sign-in with a safe return path back to the wizard', () => {
  assert.equal(CAMPAIGN_LAUNCH_SIGN_IN_URL, '/sign-in?returnTo=%2Flaunch');
  assert.equal(safeAuthReturnPath('/launch'), '/launch');
  assert.equal(safeAuthReturnPath('//outside.example/path'), '/user-portal');
  assert.equal(safeAuthReturnPath('https://outside.example/path'), '/user-portal');
});

test('USD and direct CELO targets accept the selected minimums and reject values below them', () => {
  assert.equal(isValidCampaignUsdTarget('10'), true);
  assert.equal(isValidCampaignUsdTarget('100000'), true);
  assert.equal(isValidCampaignUsdTarget('9.99'), false);
  assert.equal(isValidCampaignUsdTarget('100000.01'), false);
  assert.equal(isValidCampaignUsdTarget('10.001'), false);

  assert.equal(isValidDirectCampaignCeloTarget('0.1'), true);
  assert.equal(isValidDirectCampaignCeloTarget('0.0999'), false);
  assert.equal(isValidDirectCampaignCeloTarget('0.10001'), false);
});

test('direct CELO mode does not request USD quotes and stays available as a fallback', () => {
  assert.equal(shouldFetchCampaignUsdQuote(false, true), true);
  assert.equal(shouldFetchCampaignUsdQuote(true, true), false);
  assert.equal(shouldFetchCampaignUsdQuote(false, false), false);
  assert.equal(isValidDirectCampaignCeloTarget('0.1'), true);
});

test('expired USD quotes request one refresh and accept only a fresh replacement', async () => {
  const now = 1_700_000_000_000;
  const expiresAt = now - 1;
  assert.equal(isCampaignQuoteExpired(expiresAt, now), true);
  assert.equal(shouldAutoRefreshCampaignQuote({
    direct: false, hasQuote: true, expiresAt, now, isFetching: false, refreshedExpiry: 0,
  }), true);
  assert.equal(shouldAutoRefreshCampaignQuote({
    direct: false, hasQuote: true, expiresAt, now, isFetching: true, refreshedExpiry: 0,
  }), false);
  assert.equal(shouldAutoRefreshCampaignQuote({
    direct: false, hasQuote: true, expiresAt, now, isFetching: false, refreshedExpiry: expiresAt,
  }), false);
  assert.equal(shouldAutoRefreshCampaignQuote({
    direct: true, hasQuote: true, expiresAt, now, isFetching: false, refreshedExpiry: 0,
  }), false);

  let calls = 0;
  const freshQuote = { expiresAt: now + 60_000, celoAmount: '142.8572' };
  const accepted = await requestFreshCampaignQuote(async () => {
    calls += 1;
    return { isError: false, data: freshQuote };
  }, now);
  assert.deepEqual(accepted, freshQuote);
  assert.equal(calls, 1);

  assert.equal(await requestFreshCampaignQuote(async () => ({
    isError: false,
    data: { expiresAt: now, celoAmount: 'stale' },
  }), now), null);
  assert.equal(await requestFreshCampaignQuote(async () => ({
    isError: true,
    data: freshQuote,
  }), now), null);
});

test('invalid stored state falls back to a clean launch draft', () => {
  const storage = memoryStorage();
  storage.setItem(CAMPAIGN_LAUNCH_DRAFT_KEY, '{not-json');
  assert.deepEqual(loadCampaignLaunchDraft(storage), emptyCampaignLaunchDraft);
});
