import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { databaseSslConfig } from "./db-config";

const globalForDb = globalThis as unknown as { bodyGrowthPool?: Pool };

export const pool = globalForDb.bodyGrowthPool ?? new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 8,
  ssl: databaseSslConfig(),
});

if (process.env.NODE_ENV !== "production") globalForDb.bodyGrowthPool = pool;

export async function query<T extends QueryResultRow>(text: string, values: unknown[] = []): Promise<T[]> {
  const result = await pool.query<T>(text, values);
  return result.rows;
}

export async function transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}