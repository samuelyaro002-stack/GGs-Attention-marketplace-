import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

export const isPrivyUserId = (id: string) => /^did:privy:[a-zA-Z0-9_-]{1,128}$/.test(id);
const keys = new Map<string, JWTVerifyGetKey>();

/** Verify against this app's public keys. Never trust decoded, unsigned claims. */
export async function verifyPrivyAccessToken(
  token: string,
  appId: string,
  verificationKeys?: JWTVerifyGetKey,
) {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(appId)) throw new Error("Invalid Privy app configuration");
  let resolver = verificationKeys ?? keys.get(appId);
  if (!resolver) {
    resolver = createRemoteJWKSet(
      new URL(`https://auth.privy.io/api/v1/apps/${appId}/jwks.json`),
      { timeoutDuration: 5000 },
    );
    keys.set(appId, resolver);
  }
  const { payload } = await jwtVerify(token, resolver, {
    issuer: "privy.io",
    audience: appId,
    algorithms: ["ES256"],
    requiredClaims: ["sub", "iat", "exp", "sid"],
    clockTolerance: 5,
  });
  if (!payload.sub || !isPrivyUserId(payload.sub) ||
      typeof payload.sid !== "string" || !payload.sid ||
      typeof payload.iat !== "number" || payload.iat > Date.now() / 1000 + 5 ||
      typeof payload.exp !== "number" || payload.exp <= payload.iat) {
    throw new Error("Invalid Privy session claims");
  }
  return payload.sub;
}
