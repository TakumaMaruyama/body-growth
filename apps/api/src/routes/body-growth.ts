import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { ensureAdminBootstrap, getActor, hashPassword, verifyPassword } from "../body-growth-lib/auth";
import { HiddenResourceError } from "../body-growth-lib/authorization";
import { query, transaction } from "../body-growth-lib/db";
import { growthReference } from "../body-growth-lib/moore";
import { RATE_LIMIT_POLICY } from "../body-growth-lib/rate-limit-policy";
import {
  assertTrustedMutation,
  clientFingerprint,
  CSRF_COOKIE,
  randomToken,
  SESSION_COOKIE,
  tokenDigest,
} from "../body-growth-lib/security";
import {
  audit,
  auditNow,
  createMeasurement,
  enforceRateLimit,
  mutateMeasurement,
} from "../body-growth-lib/services";

const router = Router();
const passwordSchema = z.string().min(12).max(200);
const usernameSchema = z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9_.-]{2,63}$/);
const profileSchema = z.object({
  displayName: z.string().trim().min(1).max(100),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  formulaSex: z.enum(["female", "male"]),
});

function errorResponse(error: unknown, response: Response) {
  const status = error instanceof HiddenResourceError
    ? 404
    : typeof error === "object" && error && "status" in error
      ? Number((error as { status: number }).status)
      : 500;
  response.status(status).json({
    error: status >= 500 ? "処理を完了できませんでした" : (error as Error).message,
  });
}

function withSession(response: Response, session: string) {
  response.cookie(SESSION_COOKIE, session, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12 * 1000,
  });
  return response;
}

type Revision = {
  version: number;
  measured_on: string;
  standing_height_mm: number;
  sitting_height_mm: number | null;
  weight_g: number | null;
  formula_id: string;
  implementation_hash: string;
  parameter_hash: string;
  correction_reason: string | null;
  created_at: string;
};

type Measurement = {
  id: string;
  status: "ACTIVE" | "VOIDED";
  version: number;
  created_by_account_id: string;
  created_at: string;
  measured_on: string;
  standing_height_mm: number;
  sitting_height_mm: number | null;
  weight_g: number | null;
  formula_id: string;
  implementation_hash: string;
  parameter_hash: string;
};

async function profilePayload(profile: {
  id: string;
  account_id: string;
  username: string;
  display_name: string;
  birth_date: string;
  birth_date_source: "SELF_REPORTED";
  formula_sex: "female" | "male";
}) {
  const measurements = await query<Measurement>(`
    SELECT m.id,m.status,m.version,m.created_by_account_id,m.created_at,
      r.measured_on::text,r.standing_height_mm,r.sitting_height_mm,r.weight_g,
      r.formula_id,r.implementation_hash,r.parameter_hash
    FROM body_growth.measurements m
    JOIN LATERAL (
      SELECT * FROM body_growth.measurement_revisions
      WHERE measurement_id=m.id ORDER BY version DESC LIMIT 1
    ) r ON true
    WHERE m.profile_id=$1
    ORDER BY r.measured_on DESC,m.created_at DESC
  `, [profile.id]);
  const revisions = measurements.length ? await query<Revision & { measurement_id: string }>(`
    SELECT measurement_id,version,measured_on::text,standing_height_mm,sitting_height_mm,weight_g,
      formula_id,implementation_hash,parameter_hash,correction_reason,created_at
    FROM body_growth.measurement_revisions
    WHERE measurement_id=ANY($1::uuid[])
    ORDER BY measurement_id,version DESC
  `, [measurements.map((measurement) => measurement.id)]) : [];
  const latest = measurements.find((measurement) => measurement.status === "ACTIVE");
  return {
    ...profile,
    measurements: measurements.map((measurement) => ({
      ...measurement,
      revisions: revisions.filter((revision) => revision.measurement_id === measurement.id),
    })),
    reference: growthReference({
      birthDate: profile.birth_date,
      birthDateSelfReported: profile.birth_date_source === "SELF_REPORTED",
      formulaSex: profile.formula_sex,
      measuredAt: latest?.measured_on ?? new Date().toISOString().slice(0, 10),
      heightMm: latest?.standing_height_mm ?? null,
      definition: latest
        ? {
            formulaId: latest.formula_id,
            implementationHash: latest.implementation_hash,
            parameterHash: latest.parameter_hash,
          }
        : undefined,
    }),
  };
}

async function requireActor(request: Request) {
  const actor = await getActor(request);
  if (!actor) throw new HiddenResourceError("not found");
  return actor;
}

async function requireReadyActor(request: Request) {
  const actor = await requireActor(request);
  if (actor.passwordChangeRequired) {
    throw Object.assign(new Error("パスワード変更を完了してください"), { status: 403 });
  }
  return actor;
}

async function requireAdmin(request: Request) {
  const actor = await requireReadyActor(request);
  if (actor.role !== "ADMIN") throw new HiddenResourceError("not found");
  return actor;
}

function body(request: Request) {
  return request.body && typeof request.body === "object" ? request.body : {};
}

router.use(async (request, response) => {
  const path = request.path.replace(/^\/+/, "").replace(/\/+$/, "");
  try {
    if (request.method === "GET") {
      if (path === "csrf") {
        const csrf = randomToken(24);
        response.cookie(CSRF_COOKIE, csrf, {
          httpOnly: false,
          sameSite: "strict",
          secure: process.env.NODE_ENV === "production",
          path: "/",
        });
        return response.json({ csrfToken: csrf });
      }
      if (path !== "session") throw new HiddenResourceError("not found");
      await ensureAdminBootstrap();
      const actor = await getActor(request);
      if (!actor) return response.json({ authenticated: false });
      const accounts = await query<{ username: string }>(
        "SELECT username FROM body_growth.accounts WHERE id=$1",
        [actor.accountId],
      );
      const account = {
        id: actor.accountId,
        username: accounts[0]?.username,
        role: actor.role,
        passwordChangeRequired: actor.passwordChangeRequired,
      };
      if (actor.passwordChangeRequired) return response.json({ authenticated: true, account });
      if (actor.role === "USER") {
        if (!actor.profileId) throw new HiddenResourceError("not found");
        const rows = await query<{
          id: string;
          account_id: string;
          username: string;
          display_name: string;
          birth_date: string;
          birth_date_source: "SELF_REPORTED";
          formula_sex: "female" | "male";
        }>(`
          SELECT p.id,p.account_id,a.username,p.display_name,p.birth_date::text,p.birth_date_source,p.formula_sex
          FROM body_growth.profiles p JOIN body_growth.accounts a ON a.id=p.account_id
          WHERE p.id=$1
        `, [actor.profileId]);
        if (!rows.length) throw new HiddenResourceError("not found");
        return response.json({ authenticated: true, account, profile: await profilePayload(rows[0]) });
      }
      const rows = await query<{
        id: string;
        account_id: string;
        username: string;
        display_name: string;
        birth_date: string;
        birth_date_source: "SELF_REPORTED";
        formula_sex: "female" | "male";
      }>(`
        SELECT p.id,p.account_id,a.username,p.display_name,p.birth_date::text,p.birth_date_source,p.formula_sex
        FROM body_growth.profiles p JOIN body_growth.accounts a ON a.id=p.account_id
        WHERE a.role='USER' ORDER BY a.username
      `);
      return response.json({ authenticated: true, account, profiles: await Promise.all(rows.map(profilePayload)) });
    }

    if (request.method !== "POST") throw new HiddenResourceError("not found");
    assertTrustedMutation(request);
    const input = body(request);

    if (path === "register") {
      await ensureAdminBootstrap();
      await enforceRateLimit("REGISTER", clientFingerprint(request), RATE_LIMIT_POLICY.REGISTER.max, RATE_LIMIT_POLICY.REGISTER.seconds);
      const parsed = profileSchema.extend({ username: usernameSchema, password: passwordSchema }).parse(input);
      const passwordHash = await hashPassword(parsed.password);
      const session = randomToken();
      const account = await transaction(async (client) => {
        const created = await client.query<{ id: string }>(
          "INSERT INTO body_growth.accounts(username,password_hash,role) VALUES($1,$2,'USER') RETURNING id",
          [parsed.username, passwordHash],
        );
        await client.query(
          "INSERT INTO body_growth.profiles(account_id,display_name,birth_date,formula_sex) VALUES($1,$2,$3,$4)",
          [created.rows[0].id, parsed.displayName, parsed.birthDate, parsed.formulaSex],
        );
        await client.query(
          "INSERT INTO body_growth.sessions(account_id,token_digest,expires_at) VALUES($1,$2,now()+interval '12 hours')",
          [created.rows[0].id, tokenDigest(session)],
        );
        await audit(client, created.rows[0].id, "ACCOUNT_REGISTERED", "ACCOUNT", created.rows[0].id);
        return created.rows[0];
      });
      return withSession(response.status(201), session).json({ message: "登録しました", accountId: account.id });
    }

    if (path === "login") {
      await ensureAdminBootstrap();
      const parsed = z.object({ username: usernameSchema, password: z.string().max(200) }).parse(input);
      await enforceRateLimit("LOGIN", `${clientFingerprint(request)}:${parsed.username}`, RATE_LIMIT_POLICY.LOGIN.max, RATE_LIMIT_POLICY.LOGIN.seconds);
      const rows = await query<{ id: string; password_hash: string; status: string; password_change_required: boolean }>(
        "SELECT id,password_hash,status,password_change_required FROM body_growth.accounts WHERE username=$1",
        [parsed.username],
      );
      if (!rows.length || rows[0].status !== "ACTIVE" || !(await verifyPassword(parsed.password, rows[0].password_hash))) {
        return response.status(401).json({ error: "ユーザーIDまたはパスワードが違います" });
      }
      const session = randomToken();
      await query(
        "INSERT INTO body_growth.sessions(account_id,token_digest,expires_at) VALUES($1,$2,now()+interval '12 hours')",
        [rows[0].id, tokenDigest(session)],
      );
      return withSession(response, session).json({
        message: rows[0].password_change_required ? "パスワードを変更してください" : "ログインしました",
      });
    }

    if (path === "logout") {
      const raw = request.cookies?.[SESSION_COOKIE];
      if (raw) await query("UPDATE body_growth.sessions SET revoked_at=now() WHERE token_digest=$1", [tokenDigest(raw)]);
      response.clearCookie(SESSION_COOKIE, { path: "/" });
      return response.json({ message: "ログアウトしました" });
    }

    if (path === "password/change") {
      const actor = await requireActor(request);
      if (actor.role !== "USER") throw new HiddenResourceError("not found");
      const parsed = z.object({ currentPassword: z.string().max(200), password: passwordSchema }).parse(input);
      await enforceRateLimit("PASSWORD_CHANGE", `${actor.accountId}:${clientFingerprint(request)}`, RATE_LIMIT_POLICY.PASSWORD_CHANGE.max, RATE_LIMIT_POLICY.PASSWORD_CHANGE.seconds);
      const session = randomToken();
      const changed = await transaction(async (client) => {
        const accounts = await client.query<{ password_hash: string }>("SELECT password_hash FROM body_growth.accounts WHERE id=$1 FOR UPDATE", [actor.accountId]);
        if (!accounts.rows.length || !(await verifyPassword(parsed.currentPassword, accounts.rows[0].password_hash))) return false;
        await client.query(
          "UPDATE body_growth.accounts SET password_hash=$2,password_change_required=false WHERE id=$1",
          [actor.accountId, await hashPassword(parsed.password)],
        );
        await client.query("UPDATE body_growth.sessions SET revoked_at=now() WHERE account_id=$1 AND revoked_at IS NULL", [actor.accountId]);
        await client.query(
          "INSERT INTO body_growth.sessions(account_id,token_digest,expires_at) VALUES($1,$2,now()+interval '12 hours')",
          [actor.accountId, tokenDigest(session)],
        );
        await audit(client, actor.accountId, "PASSWORD_CHANGED", "ACCOUNT", actor.accountId);
        return true;
      });
      if (!changed) return response.status(401).json({ error: "現在のパスワードが違います" });
      return withSession(response, session).json({ message: "パスワードを更新しました" });
    }

    if (path === "profile") {
      const actor = await requireReadyActor(request);
      if (actor.role !== "USER" || !actor.profileId) throw new HiddenResourceError("not found");
      const parsed = profileSchema.parse(input);
      await query(
        "UPDATE body_growth.profiles SET display_name=$2,birth_date=$3,formula_sex=$4,updated_at=now() WHERE id=$1",
        [actor.profileId, parsed.displayName, parsed.birthDate, parsed.formulaSex],
      );
      await auditNow(actor.accountId, "PROFILE_UPDATED", "PROFILE", actor.profileId);
      return response.json({ message: "プロフィールを更新しました" });
    }

    if (path === "measurements") {
      const actor = await requireReadyActor(request);
      if (actor.role !== "USER" || !actor.profileId) throw new HiddenResourceError("not found");
      await enforceRateLimit("MEASUREMENT_UPDATE", `${actor.accountId}:${clientFingerprint(request)}`, RATE_LIMIT_POLICY.MEASUREMENT_UPDATE.max, RATE_LIMIT_POLICY.MEASUREMENT_UPDATE.seconds);
      return response.status(201).json(await createMeasurement({
        actor,
        profileId: actor.profileId,
        measuredOn: String(input.measuredOn),
        heightCm: input.heightCm,
        sittingHeightCm: input.sittingHeightCm,
        weightKg: input.weightKg,
        idempotencyKey: String(input.idempotencyKey),
      }));
    }

    const segments = path.split("/");
    if (segments[0] === "measurements" && segments[2]) {
      const actor = await requireReadyActor(request);
      if (actor.role !== "USER") throw new HiddenResourceError("not found");
      await enforceRateLimit("MEASUREMENT_UPDATE", `${actor.accountId}:${clientFingerprint(request)}`, RATE_LIMIT_POLICY.MEASUREMENT_UPDATE.max, RATE_LIMIT_POLICY.MEASUREMENT_UPDATE.seconds);
      const action = segments[2] === "correct" ? "CORRECT" : segments[2] === "void" ? "VOID" : null;
      if (!action) throw new HiddenResourceError("not found");
      return response.json(await mutateMeasurement({
        actor,
        measurementId: segments[1],
        action,
        expectedVersion: Number(input.expectedVersion),
        measuredOn: input.measuredOn,
        heightCm: input.heightCm,
        sittingHeightCm: input.sittingHeightCm,
        weightKg: input.weightKg,
        reason: input.reason,
      }));
    }

    if (path === "admin/temporary-password") {
      const actor = await requireAdmin(request);
      const parsed = z.object({ accountId: z.string().uuid(), temporaryPassword: passwordSchema }).parse(input);
      const target = await query<{ id: string }>("SELECT id FROM body_growth.accounts WHERE id=$1 AND role='USER'", [parsed.accountId]);
      if (!target.length) throw new HiddenResourceError("not found");
      await transaction(async (client) => {
        await client.query(
          "UPDATE body_growth.accounts SET password_hash=$2,password_change_required=true WHERE id=$1",
          [parsed.accountId, await hashPassword(parsed.temporaryPassword)],
        );
        await client.query("UPDATE body_growth.sessions SET revoked_at=now() WHERE account_id=$1 AND revoked_at IS NULL", [parsed.accountId]);
        await audit(client, actor.accountId, "TEMPORARY_PASSWORD_SET", "ACCOUNT", parsed.accountId);
      });
      return response.json({ message: "仮パスワードを設定しました。利用者は次回ログイン時に変更が必要です。" });
    }

    throw new HiddenResourceError("not found");
  } catch (error) {
    if (error instanceof z.ZodError) return response.status(400).json({ error: "入力内容を確認してください" });
    return errorResponse(error, response);
  }
});

export default router;