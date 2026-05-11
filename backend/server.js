import "dotenv/config";
import express from "express";
import cors from "cors";
import { v4 as uuidv4 } from "uuid";
import db from "./db.js";
import { createUser, findUserByEmail, signToken, verifyPassword } from "./auth.js";
import { requireAuth } from "./middleware.js";
import { decrypt, encrypt } from "./crypto.js";
import { getPredictedEvents } from "./predictions.js";
import { syncICloudContacts } from "./icloud.js";

const app = express();
const port = process.env.PORT || 4000;
const frontendOrigin = process.env.FRONTEND_ORIGIN || "http://localhost:5173";

app.use(cors({ origin: frontendOrigin, credentials: false }));
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/auth/register", (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password || password.length < 8) {
    return res.status(400).json({ error: "Email and password (min 8 chars) are required." });
  }

  const existing = findUserByEmail(email);
  if (existing) return res.status(409).json({ error: "Email already registered." });

  const user = createUser(email, password);
  const token = signToken(user);
  return res.status(201).json({ token, user: { id: user.id, email: user.email } });
});

app.post("/api/auth/login", (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "Email and password are required." });
  const user = findUserByEmail(email);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: "Invalid credentials." });
  }
  const token = signToken(user);
  return res.json({ token, user: { id: user.id, email: user.email } });
});

app.get("/api/profiles", requireAuth, (req, res) => {
  const rows = db
    .prepare(
      "SELECT id, name, last_period_start, cycle_length, period_length, created_at, updated_at FROM profiles WHERE user_id = ? ORDER BY created_at ASC"
    )
    .all(req.user.id);
  return res.json({ profiles: rows });
});

app.post("/api/profiles", requireAuth, (req, res) => {
  const { name, last_period_start, cycle_length, period_length } = req.body || {};
  if (!name || !last_period_start || !cycle_length || !period_length) {
    return res.status(400).json({ error: "Missing profile fields." });
  }
  const now = new Date().toISOString();
  const id = uuidv4();
  db.prepare(
    `INSERT INTO profiles (id, user_id, name, last_period_start, cycle_length, period_length, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, req.user.id, name.trim(), last_period_start, Number(cycle_length), Number(period_length), now, now);
  const profile = db
    .prepare(
      "SELECT id, name, last_period_start, cycle_length, period_length, created_at, updated_at FROM profiles WHERE id = ?"
    )
    .get(id);
  return res.status(201).json({ profile });
});

app.put("/api/profiles/:id", requireAuth, (req, res) => {
  const { id } = req.params;
  const existing = db.prepare("SELECT id FROM profiles WHERE id = ? AND user_id = ?").get(id, req.user.id);
  if (!existing) return res.status(404).json({ error: "Profile not found." });

  const { name, last_period_start, cycle_length, period_length } = req.body || {};
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE profiles
       SET name = ?, last_period_start = ?, cycle_length = ?, period_length = ?, updated_at = ?
     WHERE id = ? AND user_id = ?`
  ).run(name, last_period_start, Number(cycle_length), Number(period_length), now, id, req.user.id);
  const profile = db
    .prepare(
      "SELECT id, name, last_period_start, cycle_length, period_length, created_at, updated_at FROM profiles WHERE id = ?"
    )
    .get(id);
  return res.json({ profile });
});

app.delete("/api/profiles/:id", requireAuth, (req, res) => {
  const result = db.prepare("DELETE FROM profiles WHERE id = ? AND user_id = ?").run(req.params.id, req.user.id);
  if (!result.changes) return res.status(404).json({ error: "Profile not found." });
  return res.status(204).send();
});

app.get("/api/predictions", requireAuth, (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ error: "from and to query params are required." });
  const fromDate = new Date(String(from));
  const toDate = new Date(String(to));
  const profiles = db
    .prepare(
      "SELECT id, name, last_period_start, cycle_length, period_length FROM profiles WHERE user_id = ?"
    )
    .all(req.user.id);
  const events = profiles.flatMap((profile) => getPredictedEvents(profile, fromDate, toDate));
  return res.json({ events });
});

app.post("/api/icloud/connect", requireAuth, async (req, res) => {
  const { appleId, appSpecificPassword } = req.body || {};
  if (!appleId || !appSpecificPassword) {
    return res.status(400).json({ error: "appleId and appSpecificPassword are required." });
  }
  try {
    // Validate credentials immediately by fetching contacts once.
    await syncICloudContacts(appleId, appSpecificPassword);
    const encrypted = encrypt(appSpecificPassword);
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO icloud_connections (user_id, apple_id, encrypted_password, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET apple_id=excluded.apple_id, encrypted_password=excluded.encrypted_password, updated_at=excluded.updated_at`
    ).run(req.user.id, appleId, encrypted, now, now);
    return res.json({ connected: true });
  } catch (err) {
    return res.status(400).json({ error: err.message || "Failed to connect iCloud." });
  }
});

app.post("/api/icloud/sync", requireAuth, async (req, res) => {
  const row = db
    .prepare("SELECT apple_id, encrypted_password FROM icloud_connections WHERE user_id = ?")
    .get(req.user.id);
  if (!row) return res.status(404).json({ error: "iCloud not connected." });

  try {
    const names = await syncICloudContacts(row.apple_id, decrypt(row.encrypted_password));
    const now = new Date().toISOString();
    const insertStmt = db.prepare(
      `INSERT INTO profiles (id, user_id, name, last_period_start, cycle_length, period_length, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );

    let imported = 0;
    for (const name of names) {
      const exists = db
        .prepare("SELECT id FROM profiles WHERE user_id = ? AND lower(name) = lower(?)")
        .get(req.user.id, name);
      if (!exists) {
        insertStmt.run(uuidv4(), req.user.id, name, now.slice(0, 10), 28, 5, now, now);
        imported += 1;
      }
    }
    return res.json({ imported, totalContacts: names.length });
  } catch (err) {
    return res.status(400).json({ error: err.message || "Failed to sync contacts." });
  }
});

app.listen(port, () => {
  console.log(`CycleSync backend listening on http://localhost:${port}`);
});

