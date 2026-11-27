import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { verifyPrivyAccessToken } from "./privy-auth.ts";
import { requireAuth, requireAdmin, isAdminUser } from "./middlewares/security.ts";
import authRouter from "./routes/auth.ts";

const appId = "privy-auth-unit-tests";
const userId = "did:privy:unit_test_member";
const { publicKey, privateKey } = await generateKeyPair("ES256");
const jwk = { ...await exportJWK(publicKey), kid: "test-key", alg: "ES256", use: "sig" };
const resolver = createLocalJWKSet({ keys: [jwk] });
const claims = () => ({ sub: userId, sid: "unit_session", iss: "privy.io", aud: appId,
  iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 });
const sign = (payload, key = privateKey) =>
  new SignJWT(payload).setProtectedHeader({ alg: "ES256", kid: "test-key" }).sign(key);

test("Privy tokens require a valid app-bound signature and DID", async () => {
  assert.equal(await verifyPrivyAccessToken(await sign(claims()), appId, resolver), userId);
  for (const change of [{ aud: "another-app" }, { iss: "attacker" },
    { sub: "user_clerk" }, { sub: "did:privy:" },
    { exp: Math.floor(Date.now() / 1000) - 20 }, { iat: Math.floor(Date.now() / 1000) + 60 }]) {
    await assert.rejects(verifyPrivyAccessToken(await sign({ ...claims(), ...change }), appId, resolver));
  }
  for (const name of ["exp", "iat", "sid", "sub"]) {
    const payload = claims(); delete payload[name];
    await assert.rejects(verifyPrivyAccessToken(await sign(payload), appId, resolver));
  }
  const other = await generateKeyPair("ES256");
  await assert.rejects(verifyPrivyAccessToken(await sign(claims(), other.privateKey), appId, resolver));
  await assert.rejects(verifyPrivyAccessToken("not-a-token", appId, resolver));
  const symmetric = new SignJWT(claims()).setProtectedHeader({ alg: "HS256", kid: "test-key" });
  await assert.rejects(verifyPrivyAccessToken(await symmetric.sign(new Uint8Array(32)), appId, resolver));
});

test("verified auth/me, empty allowlist, explicit approval, and old-session rejection", async () => {
  const saved = { appId: process.env.PRIVY_APP_ID, ids: process.env.PRIVY_ADMIN_USER_IDS,
    clerkIds: process.env.CLERK_ADMIN_USER_IDS };
  const originalFetch = globalThis.fetch;
  process.env.PRIVY_APP_ID = appId;
  process.env.PRIVY_ADMIN_USER_IDS = "";
  process.env.CLERK_ADMIN_USER_IDS = userId;
  globalThis.fetch = async (input, options) => {
    if (String(input) === `https://auth.privy.io/api/v1/apps/${appId}/jwks.json`) {
      return new Response(JSON.stringify({ keys: [jwk] }), { headers: { "content-type": "application/json" } });
    }
    return originalFetch(input, options);
  };
  const app = express();
  app.use("/api", authRouter);
  app.get("/admin", requireAuth, requireAdmin, (_req, res) => res.json({ authorized: true }));
  const server = await new Promise(resolve => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    const token = await sign(claims());
    const headers = { authorization: `Bearer ${token}`, "x-user-id": "did:privy:spoofed" };
    assert.equal((await fetch(`${url}/api/auth/me`)).status, 401);
    assert.equal((await fetch(`${url}/api/auth/me`, { headers: { cookie: "__session=old-clerk-session" } })).status, 401);
    assert.equal((await fetch(`${url}/api/auth/me`, { headers: { authorization: "Bearer forged" } })).status, 401);
    const me = await fetch(`${url}/api/auth/me?userId=did:privy:spoofed`, { headers });
    assert.equal(me.status, 200);
    assert.match(me.headers.get("cache-control"), /no-store/);
    assert.deepEqual(await me.json(), { id: userId, displayName: userId, isAdmin: false });
    assert.equal((await fetch(`${url}/admin`, { headers })).status, 403);
    process.env.PRIVY_ADMIN_USER_IDS = "user_clerk";
    assert.equal(isAdminUser("user_clerk"), false);
    assert.equal((await fetch(`${url}/admin`, { headers })).status, 403);
    process.env.PRIVY_ADMIN_USER_IDS = userId;
    assert.equal((await fetch(`${url}/admin`, { headers })).status, 200);
    delete process.env.PRIVY_APP_ID;
    assert.equal((await fetch(`${url}/api/auth/me`, { headers })).status, 503);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    globalThis.fetch = originalFetch;
    for (const [key, value] of [["PRIVY_APP_ID", saved.appId], ["PRIVY_ADMIN_USER_IDS", saved.ids],
      ["CLERK_ADMIN_USER_IDS", saved.clerkIds]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
