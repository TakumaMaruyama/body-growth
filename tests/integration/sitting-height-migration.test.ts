import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../../apps/api/src/body-growth-lib/db";

const enabled =
  process.env.BODY_GROWTH_RUN_DB_TESTS === "1" &&
  Boolean(process.env.DATABASE_URL);

describe.runIf(enabled)("sitting-height removal migration", () => {
  let migrationSql = "";

  beforeAll(async () => {
    migrationSql = await readFile(
      new URL(
        "../../db/migrations/005_remove_sitting_height.sql",
        import.meta.url,
      ),
      "utf8",
    );
  });

  afterAll(async () => {
    await pool.end();
  });

  async function createIsolatedSchema() {
    const schema = `body_growth_migration_test_${randomUUID().replaceAll("-", "")}`;
    const client = await pool.connect();
    try {
      await client.query(`CREATE SCHEMA "${schema}"`);
      await client.query(
        `CREATE TABLE "${schema}".measurement_revisions(sitting_height_mm integer)`,
      );
      const scopedSql = migrationSql.replaceAll(
        "body_growth.measurement_revisions",
        `"${schema}".measurement_revisions`,
      );
      return { client, schema, scopedSql };
    } catch (error) {
      try {
        await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      } finally {
        client.release();
      }
      throw error;
    }
  }

  it("applies when no sitting-height value exists", async () => {
    const { client, schema, scopedSql } = await createIsolatedSchema();
    try {
      await client.query(scopedSql);
      const column = await client.query(
        `
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema=$1
            AND table_name='measurement_revisions'
            AND column_name='sitting_height_mm'
        `,
        [schema],
      );
      expect(column.rowCount).toBe(0);
    } finally {
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      client.release();
    }
  });

  it("stops without dropping the column when recorded data exists", async () => {
    const { client, schema, scopedSql } = await createIsolatedSchema();
    try {
      await client.query(
        `INSERT INTO "${schema}".measurement_revisions(sitting_height_mm) VALUES(784)`,
      );
      await expect(client.query(scopedSql)).rejects.toThrow(
        /sitting-height removal stopped/i,
      );
      const column = await client.query(
        `
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema=$1
            AND table_name='measurement_revisions'
            AND column_name='sitting_height_mm'
        `,
        [schema],
      );
      expect(column.rowCount).toBe(1);
      const values = await client.query<{ sitting_height_mm: number }>(
        `SELECT sitting_height_mm FROM "${schema}".measurement_revisions`,
      );
      expect(values.rows).toEqual([{ sitting_height_mm: 784 }]);
    } finally {
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      client.release();
    }
  });
});
