import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import app from "../../apps/api/src/app";
import { pool } from "../../apps/api/src/body-growth-lib/db";
import {
  CSRF_COOKIE,
  SESSION_COOKIE,
  tokenDigest,
} from "../../apps/api/src/body-growth-lib/security";

const enabled =
  process.env.BODY_GROWTH_RUN_DB_TESTS === "1" &&
  Boolean(process.env.DATABASE_URL) &&
  Boolean(process.env.BODY_GROWTH_ADMIN_USERNAME) &&
  Boolean(process.env.BODY_GROWTH_ADMIN_PASSWORD);

describe.runIf(enabled)(
  "database-backed personal auth and measurements",
  () => {
    const host = "example.test";
    const origin = `http://${host}`;
    const userAgent = request.agent(app);
    const otherUserAgent = request.agent(app);
    const loginAgent = request.agent(app);
    const duplicateAgent = request.agent(app);
    const username = `test_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
    const otherUsername = `test_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
    const password = "Test-password-123!";
    const temporaryPassword = "Temporary-password-123!";
    const changedPassword = "Changed-password-123!";
    const userForwardedFor = `integration-user-${randomUUID()}`;
    const otherUserForwardedFor = `integration-other-user-${randomUUID()}`;
    const loginForwardedFor = `integration-login-${randomUUID()}`;
    const duplicateForwardedFor = `integration-duplicate-${randomUUID()}`;
    const rateLimitEntries = new Map<
      string,
      { action: string; subjectDigest: string }
    >();
    const accountIds: string[] = [];
    const profileIds: string[] = [];
    const measurementIds: string[] = [];
    let accountId = "";
    let profileId = "";
    let otherAccountId = "";
    let otherProfileId = "";
    let measurementId = "";
    let adminSessionToken = "";

    function fingerprint(forwardedFor: string) {
      return tokenDigest(forwardedFor);
    }

    function trackRateLimit(action: string, subject: string) {
      const subjectDigest = tokenDigest(subject);
      rateLimitEntries.set(`${action}:${subjectDigest}`, {
        action,
        subjectDigest,
      });
    }

    async function csrfFor(agent: typeof userAgent) {
      const csrf = await agent.get("/api/csrf").set("host", host);
      expect(csrf.status).toBe(200);
      return csrf.body.csrfToken as string;
    }

    async function postWithCsrf(
      agent: typeof userAgent,
      path: string,
      body: Record<string, unknown>,
      forwardedFor: string,
    ) {
      const csrfToken = await csrfFor(agent);
      return agent
        .post(path)
        .set("host", host)
        .set("origin", origin)
        .set("x-forwarded-for", forwardedFor)
        .set("x-csrf-token", csrfToken)
        .send(body);
    }

    it("registers one account and profile, rejects a case-insensitive duplicate, and rejects a wrong password", async () => {
      trackRateLimit("REGISTER", fingerprint(userForwardedFor));
      const registration = await postWithCsrf(
        userAgent,
        "/api/register",
        {
          username,
          password,
          displayName: "Integration Test",
          birthDate: "2012-01-01",
          formulaSex: "female",
        },
        userForwardedFor,
      );
      expect(registration.status).toBe(201);
      accountId = registration.body.accountId;
      accountIds.push(accountId);

      const session = await userAgent.get("/api/session");
      expect(session.status).toBe(200);
      expect(session.body.account).toMatchObject({
        id: accountId,
        role: "USER",
      });
      expect(session.body.profile).toMatchObject({
        account_id: accountId,
        birth_date_source: "SELF_REPORTED",
      });
      profileId = session.body.profile.id;
      profileIds.push(profileId);

      const accountAndProfile = await pool.query<{
        account_count: string;
        profile_count: string;
      }>(
        `
      SELECT
        (SELECT count(*)::text FROM body_growth.accounts WHERE id=$1) AS account_count,
        (SELECT count(*)::text FROM body_growth.profiles WHERE account_id=$1) AS profile_count
    `,
        [accountId],
      );
      expect(accountAndProfile.rows[0]).toEqual({
        account_count: "1",
        profile_count: "1",
      });

      trackRateLimit("REGISTER", fingerprint(duplicateForwardedFor));
      const duplicate = await postWithCsrf(
        duplicateAgent,
        "/api/register",
        {
          username: username.toUpperCase(),
          password,
          displayName: "Duplicate Test",
          birthDate: "2012-01-01",
          formulaSex: "female",
        },
        duplicateForwardedFor,
      );
      expect(duplicate.status).toBe(409);
      expect(duplicate.body.error).toBe("このユーザーIDは既に使用されています");

      trackRateLimit("LOGIN", `${fingerprint(loginForwardedFor)}:${username}`);
      const wrongPassword = await postWithCsrf(
        loginAgent,
        "/api/login",
        {
          username,
          password: "Wrong-password-123!",
        },
        loginForwardedFor,
      );
      expect(wrongPassword.status).toBe(401);
    });

    it("keeps measurement history immutable and inaccessible to another USER", async () => {
      trackRateLimit("REGISTER", fingerprint(otherUserForwardedFor));
      const otherRegistration = await postWithCsrf(
        otherUserAgent,
        "/api/register",
        {
          username: otherUsername,
          password,
          displayName: "Other Integration Test",
          birthDate: "2011-01-01",
          formulaSex: "male",
        },
        otherUserForwardedFor,
      );
      expect(otherRegistration.status).toBe(201);
      otherAccountId = otherRegistration.body.accountId;
      accountIds.push(otherAccountId);

      const otherSession = await otherUserAgent.get("/api/session");
      expect(otherSession.status).toBe(200);
      otherProfileId = otherSession.body.profile.id;
      profileIds.push(otherProfileId);

      trackRateLimit(
        "MEASUREMENT_UPDATE",
        `${accountId}:${fingerprint(userForwardedFor)}`,
      );
      const idempotencyKey = randomUUID();
      const createPayload = {
        measuredOn: "2026-08-30",
        heightCm: 150.2,
        weightKg: 42.8,
        idempotencyKey,
      };
      const created = await postWithCsrf(
        userAgent,
        "/api/measurements",
        createPayload,
        userForwardedFor,
      );
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({ version: 1, status: "ACTIVE" });
      measurementId = created.body.id;
      measurementIds.push(measurementId);

      trackRateLimit(
        "MEASUREMENT_UPDATE",
        `${accountId}:${fingerprint(userForwardedFor)}`,
      );
      const replayed = await postWithCsrf(
        userAgent,
        "/api/measurements",
        createPayload,
        userForwardedFor,
      );
      expect(replayed.status).toBe(201);
      expect(replayed.body).toEqual(created.body);
      const createdCounts = await pool.query<{
        measurement_count: number;
        revision_count: number;
      }>(
        `
        SELECT
          (SELECT count(*)::integer FROM body_growth.measurements WHERE id=$1) AS measurement_count,
          (SELECT count(*)::integer FROM body_growth.measurement_revisions WHERE measurement_id=$1) AS revision_count
      `,
        [measurementId],
      );
      expect(createdCounts.rows[0]).toEqual({
        measurement_count: 1,
        revision_count: 1,
      });

      trackRateLimit(
        "MEASUREMENT_UPDATE",
        `${accountId}:${fingerprint(userForwardedFor)}`,
      );
      const corrected = await postWithCsrf(
        userAgent,
        `/api/measurements/${measurementId}/correct`,
        {
          expectedVersion: 1,
          measuredOn: "2026-08-30",
          heightCm: 150.6,
          weightKg: 43.1,
          reason: "再測定",
        },
        userForwardedFor,
      );
      expect(corrected.status).toBe(200);
      expect(corrected.body).toMatchObject({
        id: measurementId,
        version: 2,
        status: "ACTIVE",
      });

      trackRateLimit(
        "MEASUREMENT_UPDATE",
        `${accountId}:${fingerprint(userForwardedFor)}`,
      );
      const staleCorrection = await postWithCsrf(
        userAgent,
        `/api/measurements/${measurementId}/correct`,
        {
          expectedVersion: 1,
          measuredOn: "2026-08-30",
          heightCm: 151,
          weightKg: 44,
          reason: "stale version",
        },
        userForwardedFor,
      );
      expect(staleCorrection.status).toBe(409);

      trackRateLimit(
        "MEASUREMENT_UPDATE",
        `${accountId}:${fingerprint(userForwardedFor)}`,
      );
      const voided = await postWithCsrf(
        userAgent,
        `/api/measurements/${measurementId}/void`,
        {
          expectedVersion: 2,
          reason: "入力ミス",
        },
        userForwardedFor,
      );
      expect(voided.status).toBe(200);
      expect(voided.body).toMatchObject({
        id: measurementId,
        version: 3,
        status: "VOIDED",
      });

      const profile = await userAgent.get("/api/session");
      const measurement = profile.body.profile.measurements.find(
        (row: { id: string }) => row.id === measurementId,
      );
      expect(measurement).toMatchObject({
        standing_height_mm: 1506,
        weight_g: 43100,
        status: "VOIDED",
        version: 3,
      });
      expect(measurement).not.toHaveProperty("sitting_height_mm");
      expect(measurement.revisions).toHaveLength(2);
      expect(
        measurement.revisions.map(
          (revision: { version: number }) => revision.version,
        ),
      ).toEqual([2, 1]);

      trackRateLimit(
        "MEASUREMENT_UPDATE",
        `${otherAccountId}:${fingerprint(otherUserForwardedFor)}`,
      );
      const otherUserAttempt = await postWithCsrf(
        otherUserAgent,
        `/api/measurements/${measurementId}/correct`,
        {
          expectedVersion: 3,
          measuredOn: "2026-08-30",
          heightCm: 160,
          weightKg: 50,
          reason: "not allowed",
        },
        otherUserForwardedFor,
      );
      expect(otherUserAttempt.status).toBe(404);
    });

    it("allows ADMIN to view all users but not mutate their measurements, then expires a reset USER session", async () => {
      const admins = await pool.query<{ id: string }>(
        "SELECT id FROM body_growth.accounts WHERE role='ADMIN'",
      );
      expect(admins.rows).toHaveLength(1);
      adminSessionToken = randomUUID();
      await pool.query(
        "INSERT INTO body_growth.sessions(account_id,token_digest,expires_at) VALUES($1,$2,now()+interval '5 minutes')",
        [admins.rows[0].id, tokenDigest(adminSessionToken)],
      );

      const adminSession = await request(app)
        .get("/api/session")
        .set("host", host)
        .set("cookie", `${SESSION_COOKIE}=${adminSessionToken}`);
      expect(adminSession.status).toBe(200);
      expect(adminSession.body.account).toMatchObject({ role: "ADMIN" });
      expect(
        adminSession.body.profiles.map(
          (profile: { account_id: string }) => profile.account_id,
        ),
      ).toEqual(expect.arrayContaining([accountId, otherAccountId]));

      const csrf = await request(app)
        .get("/api/csrf")
        .set("host", host)
        .set("cookie", `${SESSION_COOKIE}=${adminSessionToken}`);
      expect(csrf.status).toBe(200);
      const adminCookie = `${SESSION_COOKIE}=${adminSessionToken}; ${CSRF_COOKIE}=${csrf.body.csrfToken as string}`;

      const adminMutation = await request(app)
        .post(`/api/measurements/${measurementId}/correct`)
        .set("host", host)
        .set("origin", origin)
        .set("cookie", adminCookie)
        .set("x-csrf-token", csrf.body.csrfToken as string)
        .send({
          expectedVersion: 3,
          measuredOn: "2026-08-30",
          heightCm: 160,
          weightKg: 50,
          reason: "not allowed",
        });
      expect(adminMutation.status).toBe(404);

      const temporaryPasswordResponse = await request(app)
        .post("/api/admin/temporary-password")
        .set("host", host)
        .set("origin", origin)
        .set("cookie", adminCookie)
        .set("x-csrf-token", csrf.body.csrfToken as string)
        .send({ accountId, temporaryPassword });
      expect(temporaryPasswordResponse.status).toBe(200);

      const invalidated = await userAgent.get("/api/session");
      expect(invalidated.body).toEqual({ authenticated: false });

      trackRateLimit("LOGIN", `${fingerprint(userForwardedFor)}:${username}`);
      const temporaryLogin = await postWithCsrf(
        userAgent,
        "/api/login",
        {
          username,
          password: temporaryPassword,
        },
        userForwardedFor,
      );
      expect(temporaryLogin.status).toBe(200);
      const passwordChangeRequired = await userAgent.get("/api/session");
      expect(passwordChangeRequired.body).toMatchObject({
        authenticated: true,
        account: { id: accountId, passwordChangeRequired: true },
      });
      expect(passwordChangeRequired.body).not.toHaveProperty("profile");

      trackRateLimit(
        "PASSWORD_CHANGE",
        `${accountId}:${fingerprint(userForwardedFor)}`,
      );
      const passwordChange = await postWithCsrf(
        userAgent,
        "/api/password/change",
        {
          currentPassword: temporaryPassword,
          password: changedPassword,
        },
        userForwardedFor,
      );
      expect(passwordChange.status).toBe(200);
      const changedSession = await userAgent.get("/api/session");
      expect(changedSession.body).toMatchObject({
        authenticated: true,
        account: { id: accountId, passwordChangeRequired: false },
        profile: { id: profileId },
      });

      trackRateLimit("LOGIN", `${fingerprint(loginForwardedFor)}:${username}`);
      const oldTemporaryPassword = await postWithCsrf(
        loginAgent,
        "/api/login",
        { username, password: temporaryPassword },
        loginForwardedFor,
      );
      expect(oldTemporaryPassword.status).toBe(401);

      trackRateLimit("LOGIN", `${fingerprint(loginForwardedFor)}:${username}`);
      const changedPasswordLogin = await postWithCsrf(
        loginAgent,
        "/api/login",
        { username, password: changedPassword },
        loginForwardedFor,
      );
      expect(changedPasswordLogin.status).toBe(200);
      const changedPasswordSession = await loginAgent.get("/api/session");
      expect(changedPasswordSession.body).toMatchObject({
        authenticated: true,
        account: { id: accountId, passwordChangeRequired: false },
      });
    });

    afterAll(async () => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const discovered = await client.query<{
          account_id: string;
          profile_id: string | null;
          measurement_id: string | null;
        }>(
          `
          SELECT a.id AS account_id,p.id AS profile_id,m.id AS measurement_id
          FROM body_growth.accounts a
          LEFT JOIN body_growth.profiles p ON p.account_id=a.id
          LEFT JOIN body_growth.measurements m ON m.profile_id=p.id
          WHERE a.username=ANY($1::text[])
        `,
          [[username, otherUsername]],
        );
        for (const row of discovered.rows) {
          if (!accountIds.includes(row.account_id))
            accountIds.push(row.account_id);
          if (row.profile_id && !profileIds.includes(row.profile_id)) {
            profileIds.push(row.profile_id);
          }
          if (
            row.measurement_id &&
            !measurementIds.includes(row.measurement_id)
          ) {
            measurementIds.push(row.measurement_id);
          }
        }
        await client.query(
          "ALTER TABLE body_growth.measurement_revisions DISABLE TRIGGER measurement_revisions_append_only",
        );
        await client.query(
          "ALTER TABLE body_growth.audit_events DISABLE TRIGGER audit_events_append_only",
        );
        if (measurementIds.length) {
          await client.query(
            "DELETE FROM body_growth.measurement_revisions WHERE measurement_id=ANY($1::uuid[])",
            [measurementIds],
          );
          await client.query(
            "DELETE FROM body_growth.measurements WHERE id=ANY($1::uuid[])",
            [measurementIds],
          );
        }
        if (accountIds.length || profileIds.length || measurementIds.length) {
          await client.query(
            "DELETE FROM body_growth.audit_events WHERE actor_account_id=ANY($1::uuid[]) OR entity_id=ANY($2::uuid[])",
            [accountIds, [...accountIds, ...profileIds, ...measurementIds]],
          );
        }
        if (accountIds.length) {
          await client.query(
            "DELETE FROM body_growth.idempotency_keys WHERE account_id=ANY($1::uuid[])",
            [accountIds],
          );
          await client.query(
            "DELETE FROM body_growth.sessions WHERE account_id=ANY($1::uuid[])",
            [accountIds],
          );
        }
        if (adminSessionToken) {
          await client.query(
            "DELETE FROM body_growth.sessions WHERE token_digest=$1",
            [tokenDigest(adminSessionToken)],
          );
        }
        if (profileIds.length) {
          await client.query(
            "DELETE FROM body_growth.profiles WHERE id=ANY($1::uuid[])",
            [profileIds],
          );
        }
        if (accountIds.length) {
          await client.query(
            "DELETE FROM body_growth.accounts WHERE id=ANY($1::uuid[])",
            [accountIds],
          );
        }
        for (const { action, subjectDigest } of rateLimitEntries.values()) {
          await client.query(
            "DELETE FROM body_growth.rate_limits WHERE action=$1 AND subject_digest=$2",
            [action, subjectDigest],
          );
        }
        await client.query(
          "ALTER TABLE body_growth.audit_events ENABLE TRIGGER audit_events_append_only",
        );
        await client.query(
          "ALTER TABLE body_growth.measurement_revisions ENABLE TRIGGER measurement_revisions_append_only",
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
        await pool.end();
      }
    });
  },
);
