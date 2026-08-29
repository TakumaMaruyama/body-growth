import { describe, expect, it, vi } from "vitest";
import {
  legacyBusinessDataExists,
  migrationIsApplied,
} from "../../apps/api/src/migration-preflight.mjs";

describe("legacy migration preflight", () => {
  it("does not create migration history while inspecting an unmigrated schema", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ table_name: null }] })
      .mockResolvedValueOnce({ rows: [{ table_name: "accounts" }] })
      .mockResolvedValueOnce({ rows: [{ has_data: true }] });
    const pool = { query };

    await expect(
      migrationIsApplied(pool, "body_growth", "002_personal_accounts.sql"),
    ).resolves.toBe(false);
    await expect(legacyBusinessDataExists(pool, "body_growth")).resolves.toBe(true);
    expect(query.mock.calls.flat().join(" ")).not.toContain("CREATE");
  });

  it("rejects unsafe schema identifiers", async () => {
    await expect(
      migrationIsApplied({ query: vi.fn() }, "bad;drop", "migration.sql"),
    ).rejects.toThrow("invalid migration schema");
  });
});