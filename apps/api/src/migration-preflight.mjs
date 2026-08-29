const LEGACY_BUSINESS_TABLES = [
  "organizations", "accounts", "memberships", "athletes", "athlete_accounts",
  "guardian_relations", "coach_assignments", "sessions", "invitations",
  "password_resets", "measurements", "measurement_revisions", "audit_events",
  "idempotency_keys", "rate_limits",
];

function safeSchema(schema) {
  if (!/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error("invalid migration schema");
  return schema;
}

export async function migrationIsApplied(pool, schema, migrationName) {
  const safe = safeSchema(schema);
  const table = `${safe}.schema_migrations`;
  const exists = await pool.query("SELECT to_regclass($1) AS table_name", [table]);
  if (!exists.rows[0]?.table_name) return false;
  const applied = await pool.query(`SELECT 1 FROM ${table} WHERE name=$1`, [migrationName]);
  return applied.rowCount > 0;
}

export async function legacyBusinessDataExists(pool, schema) {
  const safe = safeSchema(schema);
  const present = await pool.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema=$1 AND table_name=ANY($2::text[])",
    [safe, LEGACY_BUSINESS_TABLES],
  );
  const tables = present.rows.map((row) => row.table_name).filter((name) => LEGACY_BUSINESS_TABLES.includes(name));
  if (!tables.length) return false;
  const conditions = tables.map((name) => `EXISTS (SELECT 1 FROM ${safe}.${name})`).join(" OR ");
  const result = await pool.query(`SELECT ${conditions} AS has_data`);
  return result.rows[0]?.has_data === true;
}