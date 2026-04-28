var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// server/index.ts
import { randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { eq } from "drizzle-orm";
import express from "express";
import { z } from "zod";

// shared/schema.ts
var schema_exports = {};
__export(schema_exports, {
  users: () => users
});
import { pgTable, text, varchar } from "drizzle-orm/pg-core";
var users = pgTable("users", {
  id: varchar("id", { length: 36 }).primaryKey(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  username: varchar("username", { length: 255 }).notNull(),
  profileImageUrl: text("profile_image_url")
});

// server/db.ts
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
var { Pool } = pg;
if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?"
  );
}
var pool = new Pool({ connectionString: process.env.DATABASE_URL });
var db = drizzle(pool, { schema: schema_exports });

// server/index.ts
var scryptAsync = promisify(scrypt);
async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const buf = await scryptAsync(password, salt, 64);
  return `${salt}:${buf.toString("hex")}`;
}
async function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const buf = await scryptAsync(password, salt, 64);
  const hashBuf = Buffer.from(hash, "hex");
  if (buf.length !== hashBuf.length) return false;
  return timingSafeEqual(buf, hashBuf);
}
function userResponse(row) {
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    profileImageUrl: row.profileImageUrl
  };
}
var signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  username: z.string().min(1).max(255).optional()
});
var loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});
var app = express();
var port = Number(process.env.PORT ?? 5e3);
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-User-Id");
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});
app.use(express.json({ limit: "10mb" }));
app.get("/health", (_req, res) => {
  res.json({ ok: true });
});
app.post("/api/auth/signup", async (req, res) => {
  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid signup payload" });
    return;
  }
  const { email, password, username } = parsed.data;
  const normalizedEmail = email.trim().toLowerCase();
  const displayName = username?.trim() || normalizedEmail.split("@")[0] || "user";
  const existing = await db.query.users.findFirst({
    where: eq(users.email, normalizedEmail)
  });
  if (existing) {
    res.status(409).json({ error: "An account with this email already exists" });
    return;
  }
  const id = randomUUID();
  const passwordHash = await hashPassword(password);
  const row = {
    id,
    email: normalizedEmail,
    passwordHash,
    username: displayName,
    profileImageUrl: null
  };
  await db.insert(users).values(row);
  res.status(201).json({ user: userResponse(row) });
});
app.post("/api/auth/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid login payload" });
    return;
  }
  const { email, password } = parsed.data;
  const normalizedEmail = email.trim().toLowerCase();
  const row = await db.query.users.findFirst({
    where: eq(users.email, normalizedEmail)
  });
  if (!row || !await verifyPassword(password, row.passwordHash)) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }
  res.json({ user: userResponse(row) });
});
app.get("/api/auth/me", async (req, res) => {
  const userId = req.header("X-User-Id")?.trim();
  if (!userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const row = await db.query.users.findFirst({
    where: eq(users.id, userId)
  });
  if (!row) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  res.json({ user: userResponse(row) });
});
app.post("/api/auth/logout", (_req, res) => {
  res.json({ ok: true });
});
app.listen(port, "0.0.0.0", () => {
  console.log(`API listening on http://0.0.0.0:${port}`);
});
