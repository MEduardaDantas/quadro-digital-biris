// Cria um quadro DE VERDADE — diferente de seed.js (que é só pra
// desenvolvimento local, sempre cria "demo-frame" com senha "1234").
//
// Por padrão gera um token longo e aleatório (vai na URL do QR Code) e
// um PIN numérico aleatório (a senha que a pessoa digita depois de
// escanear). Nenhum dos dois fica salvo em texto puro — só o hash da
// senha vai pro banco. Os dois são mostrados UMA VEZ no terminal:
// anote nesse momento, não tem como recuperar depois (só trocar).
//
// Uso:
//   npm run create-frame
//
// Pra escolher você mesmo o token/senha em vez de gerar aleatório:
//   FRAME_TOKEN=meu-token-proprio FRAME_PASSWORD=123456 npm run create-frame

require("dotenv").config();
const crypto = require("crypto");
const bcrypt = require("bcrypt");
const { Pool } = require("pg");

function randomToken() {
  // ~12 caracteres, seguro o bastante pra não ser adivinhado por tentativa e erro
  return crypto.randomBytes(9).toString("base64url");
}

function randomPin(digits = 6) {
  const max = 10 ** digits;
  return String(crypto.randomInt(0, max)).padStart(digits, "0");
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  const token = process.env.FRAME_TOKEN || randomToken();
  const password = process.env.FRAME_PASSWORD || randomPin();

  const existing = await pool.query("SELECT id FROM frames WHERE token = $1", [token]);
  if (existing.rows.length > 0) {
    console.error(`Já existe um quadro com o token "${token}".`);
    console.error("Escolha outro com FRAME_TOKEN=... ou apague o existente antes.");
    await pool.end();
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const result = await pool.query(
    `INSERT INTO frames (token, password_hash, current_version) VALUES ($1, $2, 0) RETURNING id`,
    [token, passwordHash]
  );
  const frameId = result.rows[0].id;

  await pool.query(`INSERT INTO current_state (frame_id, version) VALUES ($1, 0)`, [frameId]);

  console.log("");
  console.log("========================================================");
  console.log("  Quadro criado — anote isso agora, não vai aparecer de novo");
  console.log("========================================================");
  console.log(`  Token (vai no QR Code):  ${token}`);
  console.log(`  Senha (PIN):             ${password}`);
  console.log(`  frame_id interno:        ${frameId}`);
  console.log("========================================================");
  console.log("");
  console.log("A URL que o QR Code deve apontar (troque pelo seu domínio):");
  console.log(`  https://SEU_DOMINIO/q/${token}`);
  console.log("");

  await pool.end();
}

main().catch((err) => {
  console.error("Falha ao criar o quadro:", err);
  process.exit(1);
});
