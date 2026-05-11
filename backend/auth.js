import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { v4 as uuidv4 } from "uuid";
import db from "./db.js";

const JWT_SECRET = process.env.JWT_SECRET || "dev-jwt-secret-change-me";
const JWT_EXP = "7d";

export function hashPassword(password) {
  return bcrypt.hashSync(password, 10);
}

export function verifyPassword(password, hash) {
  return bcrypt.compareSync(password, hash);
}

export function createUser(email, password) {
  const id = uuidv4();
  const now = new Date().toISOString();
  const stmt = db.prepare(
    "INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)"
  );
  stmt.run(id, email.toLowerCase(), hashPassword(password), now);
  return { id, email: email.toLowerCase() };
}

export function findUserByEmail(email) {
  return db
    .prepare("SELECT id, email, password_hash FROM users WHERE email = ?")
    .get(email.toLowerCase());
}

export function signToken(user) {
  return jwt.sign({ sub: user.id, email: user.email }, JWT_SECRET, { expiresIn: JWT_EXP });
}

export function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

