-- Bearer-token sessions and Sign in with Apple.
--
-- Authentication previously trusted a client-supplied `X-User-Id` header, so
-- any caller who knew or guessed a user id was authenticated as that user. It
-- also exposed an ungated `/api/auth/dev-login` that minted a session for any
-- email address, and fell back to a hardcoded session secret. All three are
-- removed; identity is now a random server-issued token.
--
-- Existing accounts keep working only if they sign in with Apple, which links
-- to the existing row by email on first use. Password and Replit logins are
-- gone. Inspect who is affected before applying:
--   SELECT count(*) FROM users WHERE password_hash IS NOT NULL;
--   SELECT count(*) FROM users WHERE replit_id IS NOT NULL;

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "apple_sub" text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_apple_sub_unique'
  ) THEN
    ALTER TABLE "users" ADD CONSTRAINT "users_apple_sub_unique" UNIQUE ("apple_sub");
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "sessions" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  -- SHA-256 of the bearer token. The token itself is never stored, so a
  -- database disclosure yields no usable credential.
  "token_hash" text NOT NULL UNIQUE,
  "expires_at" timestamp NOT NULL,
  "revoked_at" timestamp,
  "last_used_at" timestamp NOT NULL DEFAULT now(),
  "user_agent" text,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "sessions_token_hash_idx" ON "sessions" ("token_hash");
