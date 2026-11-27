import assert from 'node:assert/strict';
import test from 'node:test';
import { runCeloFundingWithBalanceCheck } from './celo-funding-guard.ts';

test('insufficient CELO balance stops before any funding transaction callback', async () => {
  const order = [];
  let transactionPrompts = 0;

  await assert.rejects(runCeloFundingWithBalanceCheck({
    readBalance: async () => {
      order.push('balance');
      return 99n;
    },
    requiredBalance: 100n,
    insufficientBalanceMessage: balance => `Only ${balance} available`,
    sendFundingTransaction: async () => {
      transactionPrompts += 1;
      order.push('transaction');
    },
  }), /Only 99 available/);

  assert.deepEqual(order, ['balance']);
  assert.equal(transactionPrompts, 0);
});

test('sufficient balance is checked before funding is allowed to proceed', async () => {
  const order = [];
  const result = await runCeloFundingWithBalanceCheck({
    readBalance: async () => {
      order.push('balance');
      return 100n;
    },
    requiredBalance: 100n,
    insufficientBalanceMessage: () => 'Should not be shown',
    sendFundingTransaction: async () => {
      order.push('transaction');
      return 'submitted';
    },
  });

  assert.equal(result, 'submitted');
  assert.deepEqual(order, ['balance', 'transaction']);
});
