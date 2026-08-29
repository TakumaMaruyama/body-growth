import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationUrl = new URL("../../db/migrations/003_personal_integrity.sql", import.meta.url);
const triggerFixUrl = new URL("../../db/migrations/004_profile_constraint_trigger_fix.sql", import.meta.url);

describe("personal-account database integrity migrations", () => {
  it("enforces case-insensitive usernames and one profile per user", async () => {
    const sql = await readFile(migrationUrl, "utf8");
    expect(sql).toMatch(/lower\s*\(\s*username\s*\)/i);
    expect(sql).toContain("USER accounts require exactly one profile");
    expect(sql).toContain("ADMIN accounts cannot have a profile");
  });

  it("prevents restoring voided measurements", async () => {
    const sql = await readFile(migrationUrl, "utf8");
    expect(sql).toContain("voided measurements cannot be restored");
  });

  it("ships the follow-up constraint trigger fix in order", async () => {
    const sql = await readFile(triggerFixUrl, "utf8");
    expect(sql).toMatch(/constraint trigger/i);
    expect(sql).toMatch(/deferrable initially deferred/i);
  });
});