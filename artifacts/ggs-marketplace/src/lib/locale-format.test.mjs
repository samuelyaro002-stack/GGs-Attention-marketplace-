import test from 'node:test';
import assert from 'node:assert/strict';
import { formatExactDecimal } from './locale-format.ts';

test('Spanish and French decimal separators preserve all token digits', () => {
  assert.equal(formatExactDecimal('0.000000000000000001', 'es'), '0,000000000000000001');
  assert.equal(formatExactDecimal('0.000000000000000001', 'fr'), '0,000000000000000001');
});

test('large integer token balances are not converted through floating point', () => {
  const value = '123456789012345678901234567890';
  assert.equal(formatExactDecimal(`${value}.000000000000000001`, 'en'), `${BigInt(value).toLocaleString('en')}.000000000000000001`);
});

test('English and Simplified Chinese keep decimal precision', () => {
  assert.equal(formatExactDecimal('0.125', 'en'), '0.125');
  assert.equal(formatExactDecimal('0.125', 'zh-CN'), '0.125');
});
