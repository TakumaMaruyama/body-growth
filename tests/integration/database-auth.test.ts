import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import app from "../../apps/api/src/app";
import { pool } from "../../apps/api/src/body-growth-lib/db";
import { tokenDigest } from "../../apps/api/src/body-growth-lib/security";

const enabled =
  process.env.BODY_GROWTH_RUN_DB_TESTS === "1" &&
  Boolean(process.env.DATABASE_URL) &&
  Boolean(process.env.BODY_GROWTH_ADMIN_USERNAME) &&
  Boolean(process.env.BODY_GROWTH_ADMIN_PASSWORD);

describe.runIf(enabled)("database-backed personal auth", () => {
  const agent = request.agent(app);
  const username = `test_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
  const forwardedFor = `integration-test-${randomUUID()}`;
  const registrationRateLimitDigest = tokenDigest(tokenDigest(forwardedFor));
  const password = "Test-password-123!";
  let accountId = "";
  let profileId = "";

  it("registers a USER and binds its session only to its own profile", async () => {
    const csrf = await agent.get("/api/csrf").set("host", "example.test");
    const token = csrf.body.csrfToken as string;
    const registration = await agent
      .post("/api/register")
      .set("host", "example.test")
      .set("origin", "http://example.test")
      .set("x-forwarded-for", forwardedFor)
      .set("x-csrf-token", token)
      .send({
        username,
        password,
        displayName: "Integration Test",
        birthDate: "2012-01-01",
        formulaSex: "female",
      });
    expect(registration.status).toBe(201);
    accountId = registration.body.accountId;

    const session = await agent.get("/api/session");
    expect(session.status).toBe(200);
    expect(session.body.account).toMatchObject({ id: accountId, role: "USER" });
    expect(session.body.profile).toMatchObject({
      account_id: accountId,
      birth_date_source: "SELF_REPORTED",
    });
    profileId = session.body.profile.id;
  });

  afterAll(async () => {
    if (accountId) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          "ALTER TABLE body_growth.audit_events DISABLE TRIGGER audit_events_append_only",
        );
        await client.query(
          "DELETE FROM body_growth.audit_events WHERE actor_account_id=$1 OR entity_id=$1",
          [accountId],
        );
        await client.query(
          "ALTER TABLE body_growth.audit_events ENABLE TRIGGER audit_events_append_only",
        );
        await client.query(
          "DELETE FROM body_growth.sessions WHERE account_id=$1",
          [accountId],
        );
        if (profileId) {
          await client.query(
            "DELETE FROM body_growth.profiles WHERE id=$1",
            [profileId],
          );
        }
        await client.query(
          "DELETE FROM body_growth.accounts WHERE id=$1",
          [accountId],
        );
        await client.query(
          "DELETE FROM body_growth.rate_limits WHERE action='REGISTER' AND subject_digest=$1",
          [registrationRateLimitDigest],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }
    await pool.end();
  });
});