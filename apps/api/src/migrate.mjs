import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { legacyBusinessDataExists, migrationIsApplied } from "./migration-preflight.mjs";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
try {
  const replacementMigration = "002_personal_accounts.sql";
  if (
    !(await migrationIsApplied(pool, "body_growth", replacementMigration))
    && await legacyBusinessDataExists(pool, "body_growth")
  ) {
    throw new Error("body_growth migration stopped: legacy business data exists; no changes were made");
  }
  await pool.query("CREATE SCHEMA IF NOT EXISTS body_growth");
  await pool.query("CREATE TABLE IF NOT EXISTS body_growth.schema_migrations(name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
  const migrationDir = new URL("../../../db/migrations/", import.meta.url);
  const files = (await readdir(migrationDir)).filter((name) => /^\d+_.+\.sql$/.test(name)).sort();
  for (const name of files) {
    const applied = await pool.query("SELECT 1 FROM body_growth.schema_migrations WHERE name=$1", [name]);
    if (applied.rowCount) continue;
    const sql = await readFile(join(migrationDir.pathname, name), "utf8");
    await pool.query("BEGIN");
    try {
      await pool.query(sql);
      await pool.query("INSERT INTO body_growth.schema_migrations(name) VALUES($1)", [name]);
      await pool.query("COMMIT");
      console.log(`body_growth migration applied: ${name}`);
    } catch (error) {
      await pool.query("ROLLBACK");
      throw error;
    }
  }
} finally {
  await pool.end();
}