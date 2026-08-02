import * as crypto from "crypto";
import { eq, and, isNull, gt } from "drizzle-orm";
import type { Request, Response, NextFunction } from "express";
import { db } from "./db";
import { sessions, users, type User } from "@shared/schema";

/**
 * Bearer-token authentication.
 *
 * This replaces a scheme in which `requireAuth` trusted a client-supplied
 * `X-User-Id` header and adopted whatever id it contained. Any caller who knew
 * or guessed a user id was authenticated as that user, with no secret
 * involved. On a server holding patient photographs that was a full
 * compromise, so the header path is gone entirely.
 *
 * Tokens are 32 random bytes, issued server-side, and persisted only as a
 * SHA-256 hash. A database disclosure therefore yields no usable credential.
 */

const SESSION_TTL_DAYS = 30;
const TOKEN_BYTES = 32;

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export interface IssuedSession {
  /** Returned to the client exactly once; never stored in plaintext. */
  token: string;
  expiresAt: Date;
}

export async function createSession(
  userId: string,
  userAgent?: string,
): Promise<IssuedSession> {
  const token = crypto.randomBytes(TOKEN_BYTES).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);

  await db.insert(sessions).values({
    userId,
    tokenHash: hashToken(token),
    expiresAt,
    userAgent: userAgent?.slice(0, 500) ?? null,
  });

  return { token, expiresAt };
}

export async function revokeSession(token: string): Promise<void> {
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(eq(sessions.tokenHash, hashToken(token)));
}

export async function revokeAllSessionsForUser(userId: string): Promise<void> {
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
}

/** Resolve a bearer token to its user, or null when invalid/expired/revoked. */
export async function resolveSession(token: string): Promise<User | null> {
  const rows = await db
    .select({ user: users, sessionId: sessions.id })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.tokenHash, hashToken(token)),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date()),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  // Best-effort activity tracking; never fail a request over it.
  void db
    .update(sessions)
    .set({ lastUsedAt: new Date() })
    .where(eq(sessions.id, row.sessionId))
    .catch(() => undefined);

  return row.user;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User;
      authToken?: string;
    }
  }
}

function bearerFrom(req: Request): string | null {
  const header = req.header("authorization") ?? req.header("Authorization");
  if (!header) return null;
  const [scheme, value] = header.split(" ");
  if (!scheme || scheme.toLowerCase() !== "bearer" || !value) return null;
  return value.trim() || null;
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = bearerFrom(req);
  if (!token) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const user = await resolveSession(token);
    if (!user) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    req.user = user;
    req.authToken = token;
    next();
  } catch (error) {
    console.error("Session lookup failed:", error);
    res.status(500).json({ error: "Authentication error" });
  }
}

/** Convenience for handlers that ran behind requireAuth. */
export function currentUserId(req: Request): string {
  if (!req.user) throw new Error("currentUserId() used outside requireAuth");
  return req.user.id;
}
