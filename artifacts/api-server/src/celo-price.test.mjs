import assert from "node:assert/strict";
import { build } from "esbuild";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

const source = path.join(path.dirname(fileURLToPath(import.meta.url)), "celo-price.ts");
const built = await build({
  entryPoints: [source],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  external: ["node:crypto"],
});
const moduleUrl = `data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}`;
const price = await import(moduleUrl);

test("USD quotes round CELO up to four decimals", () => {
  assert.equal(price.quoteCeloAmount("10", "0.70"), "14.2858");
  assert.equal(price.quoteCeloAmount("100.00", "0.07755"), "1289.4907");
  assert.equal(price.quoteCeloAmount("100000", "0.70"), "142857.1429");
  assert.throws(() => price.quoteCeloAmount("9.99", "0.70"), /between \$10/);
  assert.throws(() => price.quoteCeloAmount("100000.01", "0.70"), /between \$10/);
});

test("direct CELO mode enforces the minimum and four decimal places", () => {
  assert.equal(price.validateDirectCeloAmount("0.1"), "0.1");
  assert.throws(() => price.validateDirectCeloAmount("0.0999"), /minimum/);
  assert.throws(() => price.validateDirectCeloAmount("0.10001"), /four decimal places/);
});

test("signed quotes are bound to their USD amount and expire after sixty seconds", () => {
  const original = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "unit-test-secret-that-is-not-a-real-credential";
  try {
    const quote = price.createCampaignQuoteToken("50", {
      rateUsd: "0.07755",
      source: "Coinbase",
      rateUpdatedAt: 10_000,
    }, 20_000);
    assert.equal(quote.celoAmount, "644.7454");
    assert.equal(price.verifyCampaignQuoteToken(quote.quoteToken, "50.00", 20_001).rateUsd, "0.07755");
    assert.throws(() => price.verifyCampaignQuoteToken(quote.quoteToken, "51.00", 20_001), /invalid|match/i);
    assert.throws(() => price.verifyCampaignQuoteToken(quote.quoteToken, "50.00", 80_001), /expired/i);
  } finally {
    if (original === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = original;
  }
});

test("an expired USD quote can be refreshed into a newly signed quote", () => {
  const original = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "unit-test-secret-that-is-not-a-real-credential";
  try {
    const first = price.createCampaignQuoteToken("50", {
      rateUsd: "0.5",
      source: "Coinbase",
      rateUpdatedAt: 10_000,
    }, 20_000);
    assert.throws(() => price.verifyCampaignQuoteToken(first.quoteToken, "50", 80_000), /expired/i);

    const refreshed = price.createCampaignQuoteToken("50", {
      rateUsd: "0.25",
      source: "CoinGecko",
      rateUpdatedAt: 80_001,
    }, 80_001);
    assert.equal(refreshed.celoAmount, "200.0000");
    assert.equal(refreshed.source, "CoinGecko");
    assert.equal(refreshed.expiresAt, 140_001);
    assert.equal(
      price.verifyCampaignQuoteToken(refreshed.quoteToken, "50.00", 80_002).celoAmount,
      "200.0000",
    );
  } finally {
    if (original === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = original;
  }
});
