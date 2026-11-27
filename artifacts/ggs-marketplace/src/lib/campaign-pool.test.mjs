import test from 'node:test';
import assert from 'node:assert/strict';
import { celoPoolDisplay, celoRewardEstimate } from './campaign-pool.ts';
import { isPositiveCeloAmount } from '@workspace/celo-contract';
import { CreateCampaignBody } from '../../../../lib/api-zod/src/generated/api.ts';

const funded = {
  celoTargetAmount: '0.1',
  amountDepositedRaw: '250000000000000000',
  celoPoolRaw: '225000000000000000',
  onchainCampaignId: 0,
  contractAddress: '0x6799fDb282cDe85c403D1003846367d881A01FFC',
  rewardStatus: 'funded',
};

test('confirmed deposit wins when the typed target differs, including campaign id zero', () => {
  assert.deepEqual(celoPoolDisplay(funded), { target: '0.1 CELO', deposit: '0.25 CELO' });
});
test('draft intent is not an on-chain deposit', () => {
  assert.deepEqual(celoPoolDisplay({ ...funded, rewardStatus: 'draft' }), { target: '0.1 CELO', deposit: null });
  assert.equal(celoPoolDisplay({ ...funded, onchainCampaignId: null }).deposit, null);
  assert.equal(celoPoolDisplay({ ...funded, contractAddress: null }).deposit, null);
});
test('legacy USD targets are never silently converted to CELO', () => {
  assert.equal(celoPoolDisplay({ ...funded, celoTargetAmount: null }).target, 'Not set (legacy campaign)');
});
test('wei precision is retained and corrupt deposit values never fall back to the target', () => {
  assert.equal(celoPoolDisplay({ ...funded, amountDepositedRaw: '1' }).deposit, '0.000000000000000001 CELO');
  assert.equal(celoPoolDisplay({ ...funded, amountDepositedRaw: 'bad' }).deposit, null);
});
test('CELO reward estimates use the confirmed net pool, not target or gross deposit', () => {
  assert.equal(celoRewardEstimate(funded, 1, 3), '0.075 CELO');
  assert.equal(celoRewardEstimate({ ...funded, rewardStatus: 'draft' }, 1, 3), 'Not funded');
});
test('positive CELO input supports fractional tokens through 18 decimal places', () => {
  for (const value of ['0.1', '1', '0.000000000000000001', '12.123456789012345678']) assert.equal(isPositiveCeloAmount(value), true, value);
  for (const value of ['0', '0.0', '-1', '1e-3', 'NaN', '0.0000000000000000001', ' 0.1 ', '01.2', '']) assert.equal(isPositiveCeloAmount(value), false, value);
});
test('generated API accepts CELO target text without a USD value', () => {
  const parsed = CreateCampaignBody.parse({ name: 'Test campaign', cycle: '2 weeks', rewardAsset: 'CELO', pool: 0, celoTargetAmount: '0.000000000000000001' });
  assert.equal(parsed.celoTargetAmount, '0.000000000000000001');
  assert.equal(parsed.pool, 0);
});
test('G$ request contract remains unchanged', () => {
  assert.equal(CreateCampaignBody.parse({ name: 'G$ campaign', cycle: '2 weeks', pool: 5000 }).pool, 5000);
});