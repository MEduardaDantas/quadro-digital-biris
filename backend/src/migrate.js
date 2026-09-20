require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  // Controle de migrations já aplicadas — sem isso, rodar `npm run migrate`
  // de novo reaplicaria ALTER TABLE em colunas que já existem e quebraria.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const already = await pool.query("SELECT filename FROM schema_migrations");
  const appliedSet = new Set(already.rows.map((r) => r.filename));

  const dir = path.join(__dirname, "..", "migrations");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

  for (const file of files) {
    if (appliedSet.has(file)) {
      console.log(`Já aplicada, pulando: ${file}`);
      continue;
    }
    const sql = fs.readFileSync(path.join(dir, file), "utf8");
    console.log(`Aplicando migration: ${file}`);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [file]);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  console.log("Migrations aplicadas com sucesso.");
  await pool.end();
}

main().catch((err) => {
  console.error("Falha ao rodar migrations:", err);
  process.exit(1);
});
