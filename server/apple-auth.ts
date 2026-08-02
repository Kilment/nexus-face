import { createRemoteJWKSet, jwtVerify } from "jose";

/**
 * Sign in with Apple — server-side identity token verification.
 *
 * The client sends the `identityToken` it received from Apple. It is only
 * trustworthy once verified here: the signature is checked against Apple's
 * published keys, and the issuer, audience and expiry are all enforced. A
 * client-supplied identifier is never trusted on its own.
 */

const APPLE_ISSUER = "https://appleid.apple.com";
const APPLE_JWKS_URL = new URL("https://appleid.apple.com/auth/keys");

const jwks = createRemoteJWKSet(APPLE_JWKS_URL);

export interface AppleIdentity {
  /** Apple's stable per-user identifier. Unique per (user, app team). */
  sub: string;
  email: string | null;
  emailVerified: boolean;
  /** True when the address is Apple's private relay, not the real inbox. */
  isPrivateEmail: boolean;
}

function expectedAudience(): string {
  const bundleId = process.env.APPLE_BUNDLE_ID;
  if (!bundleId) {
    throw new Error(
      "APPLE_BUNDLE_ID is not set. It must equal the iOS bundle identifier " +
        "registered with Apple, or identity tokens cannot be validated.",
    );
  }
  return bundleId;
}

/** Apple sends booleans as real booleans or as the strings "true"/"false". */
function asBool(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.toLowerCase() === "true";
  return false;
}

export async function verifyAppleIdentityToken(
  identityToken: string,
): Promise<AppleIdentity> {
  const { payload } = await jwtVerify(identityToken, jwks, {
    issuer: APPLE_ISSUER,
    audience: expectedAudience(),
  });

  const sub = typeof payload.sub === "string" ? payload.sub : null;
  if (!sub) {
    throw new Error("Apple identity token has no subject claim");
  }

  const email = typeof payload.email === "string" ? payload.email : null;

  return {
    sub,
    email,
    emailVerified: asBool(payload.email_verified),
    isPrivateEmail: asBool(payload.is_private_email),
  };
}
