require("dotenv").config();
const bcrypt = require("bcrypt");
const { Pool } = require("pg");

// Trava de segurança: este script sempre cria "demo-frame" com a senha
// fixa "1234" — ótimo pra desenvolvimento local, desastroso se rodar
// sem querer contra um banco de produção. Pra criar um quadro de
// verdade, use `npm run create-frame` (gera token e senha aleatórios).
if (process.env.NODE_ENV === "production") {
  console.error("seed.js é só para desenvolvimento local (cria demo-frame/1234).");
  console.error('NODE_ENV=production detectado — recusando rodar. Use "npm run create-frame".');
  process.exit(1);
}

const DEMO_TOKEN = "demo-frame";
const DEMO_PASSWORD = "1234"; // Somente para desenvolvimento local.

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  const existing = await pool.query("SELECT id FROM frames WHERE token = $1", [DEMO_TOKEN]);
  if (existing.rows.length > 0) {
    console.log(`Frame "${DEMO_TOKEN}" já existe (id ${existing.rows[0].id}). Nada a fazer.`);
    await pool.end();
    return;
  }

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  const result = await pool.query(
    `INSERT INTO frames (token, password_hash, current_version)
     VALUES ($1, $2, 0)
     RETURNING id`,
    [DEMO_TOKEN, passwordHash]
  );
  const frameId = result.rows[0].id;

  await pool.query(
    `INSERT INTO current_state (frame_id, version)
     VALUES ($1, 0)`,
    [frameId]
  );

  console.log(`Frame de teste criado: token="${DEMO_TOKEN}" senha="${DEMO_PASSWORD}" id=${frameId}`);
  console.log("IMPORTANTE: 1234 é somente senha de desenvolvimento.");

  await pool.end();
}

main().catch((err) => {
  console.error("Falha ao rodar seed:", err);
  process.exit(1);
});
