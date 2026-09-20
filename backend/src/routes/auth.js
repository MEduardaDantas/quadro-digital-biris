const express = require("express");
const bcrypt = require("bcrypt");
const { v4: uuidv4 } = require("uuid");
const { pool } = require("../db");
const rateLimit = require("../rateLimit");
const { requireSession } = require("../middleware/session");

const router = express.Router();

const SESSION_TTL_DAYS = Number(process.env.SESSION_TTL_DAYS || 30);

function clientIp(req) {
  return req.ip || req.connection.remoteAddress || "unknown";
}

// GET /q/:token
// Identifica o quadro pelo token do QR Code, sem autenticar a pessoa.
router.get("/q/:token", async (req, res) => {
  const { token } = req.params;
  const result = await pool.query("SELECT id FROM frames WHERE token = $1", [token]);
  const frame = result.rows[0];

  if (!frame) {
    return res.status(404).json({ exists: false });
  }

  return res.json({ exists: true, frame_id: frame.id });
});

// POST /api/v1/auth/login
router.post("/api/v1/auth/login", async (req, res) => {
  const { frame_token, password } = req.body || {};

  if (!frame_token || !password) {
    return res.status(400).json({ error: "missing_fields" });
  }

  const ip = clientIp(req);

  if (rateLimit.isLocked(frame_token, ip)) {
    return res.status(429).json({ error: "too_many_attempts" });
  }

  const result = await pool.query("SELECT id, password_hash FROM frames WHERE token = $1", [
    frame_token,
  ]);
  const frame = result.rows[0];

  if (!frame) {
    rateLimit.registerFailure(frame_token, ip);
    return res.status(401).json({ authenticated: false, error: "invalid_credentials" });
  }

  const passwordOk = await bcrypt.compare(password, frame.password_hash);
  if (!passwordOk) {
    rateLimit.registerFailure(frame_token, ip);
    return res.status(401).json({ authenticated: false, error: "invalid_credentials" });
  }

  rateLimit.registerSuccess(frame_token, ip);

  const sessionToken = uuidv4() + uuidv4(); // token de sessão opaco, sem estrutura previsível
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);

  await pool.query(
    `INSERT INTO sessions (frame_id, token, expires_at) VALUES ($1, $2, $3)`,
    [frame.id, sessionToken, expiresAt]
  );

  return res.json({
    authenticated: true,
    session_token: sessionToken,
    session_expires_at: expiresAt.toISOString(),
  });
});

// POST /api/v1/auth/logout
router.post("/api/v1/auth/logout", requireSession, async (req, res) => {
  await pool.query("DELETE FROM sessions WHERE id = $1", [req.session.id]);
  return res.status(204).send();
});

module.exports = router;
