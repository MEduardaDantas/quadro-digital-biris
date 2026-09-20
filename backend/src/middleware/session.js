const { pool } = require("../db");

// Espera o header: Authorization: Bearer <session_token>
// Em caso de sucesso, popula req.session e req.frameId.
async function requireSession(req, res, next) {
  const header = req.headers["authorization"] || "";
  const [scheme, token] = header.split(" ");

  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({ error: "missing_session" });
  }

  const result = await pool.query(
    `SELECT s.id, s.frame_id, s.expires_at, f.token AS frame_token
       FROM sessions s
       JOIN frames f ON f.id = s.frame_id
      WHERE s.token = $1`,
    [token]
  );

  const session = result.rows[0];
  if (!session) {
    return res.status(401).json({ error: "invalid_session" });
  }

  if (new Date(session.expires_at).getTime() < Date.now()) {
    await pool.query("DELETE FROM sessions WHERE id = $1", [session.id]);
    return res.status(401).json({ error: "session_expired" });
  }

  req.session = session;
  req.frameId = session.frame_id;
  req.frameToken = session.frame_token;
  next();
}

module.exports = { requireSession };
