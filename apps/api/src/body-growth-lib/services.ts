import type { PoolClient } from "pg";
import { query, transaction } from "./db";
import { assertProfileAccess, HiddenResourceError } from "./authorization";
import type { ActorContext, MeasurementAction } from "./types";
import { tokenDigest } from "./security";
import { FORMULA_ID, IMPLEMENTATION_HASH, PARAMETER_HASH } from "./moore";

export class ConflictError extends Error {
  status = 409;
}
export class RateLimitError extends Error {
  status = 429;
}
export class ValidationError extends Error {
  status = 400;
}

export async function enforceRateLimit(
  action: string,
  subject: string,
  max: number,
  seconds: number,
) {
  const digest = tokenDigest(subject);
  const rows = await query<{ attempts: number; window_started_at: string }>(
    `
    INSERT INTO body_growth.rate_limits(action,subject_digest,window_started_at,attempts)
    VALUES ($1,$2,now(),1)
    ON CONFLICT(action,subject_digest) DO UPDATE SET
      attempts=CASE WHEN body_growth.rate_limits.window_started_at < now()-($3 || ' seconds')::interval THEN 1 ELSE body_growth.rate_limits.attempts+1 END,
      window_started_at=CASE WHEN body_growth.rate_limits.window_started_at < now()-($3 || ' seconds')::interval THEN now() ELSE body_growth.rate_limits.window_started_at END
    RETURNING attempts,window_started_at
  `,
    [action, digest, String(seconds)],
  );
  if (rows[0].attempts > max)
    throw new RateLimitError("しばらく待ってから再試行してください");
}

export async function audit(
  client: PoolClient,
  actorId: string | null,
  action: string,
  entityType: string,
  entityId: string | null,
  metadata: Record<string, unknown> = {},
) {
  await client.query(
    "INSERT INTO body_growth.audit_events(actor_account_id,action,entity_type,entity_id,metadata) VALUES($1,$2,$3,$4,$5)",
    [actorId, action, entityType, entityId, JSON.stringify(metadata)],
  );
}

export async function auditNow(
  actorId: string,
  action: string,
  entityType: string,
  entityId: string | null,
  metadata: Record<string, unknown> = {},
) {
  await query(
    "INSERT INTO body_growth.audit_events(actor_account_id,action,entity_type,entity_id,metadata) VALUES($1,$2,$3,$4,$5)",
    [actorId, action, entityType, entityId, JSON.stringify(metadata)],
  );
}

export async function profileForAction(
  actor: ActorContext,
  profileId: string,
  action: MeasurementAction,
) {
  const rows = await query<{ id: string; display_name: string }>(
    "SELECT id,display_name FROM body_growth.profiles WHERE id=$1",
    [profileId],
  );
  if (!rows.length) throw new HiddenResourceError("not found");
  assertProfileAccess(actor, profileId, action);
  return rows[0];
}

export function toMillimetres(value: unknown, required = false): number | null {
  if (value === null || value === undefined || value === "") {
    if (required) throw new ValidationError("必須値が未入力です");
    return null;
  }
  const number = Number(value);
  if (!Number.isFinite(number))
    throw new ValidationError("数値を確認してください");
  const result = Math.round(number * 10);
  if (result < 500 || result > 2500)
    throw new ValidationError("身長の値を確認してください");
  return result;
}

export function toGrams(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number))
    throw new ValidationError("数値を確認してください");
  const result = Math.round(number * 1000);
  if (result < 1000 || result > 300000)
    throw new ValidationError("体重の値を確認してください");
  return result;
}

export function isStrictDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

export async function createMeasurement(input: {
  actor: ActorContext;
  profileId: string;
  measuredOn: string;
  heightCm: unknown;
  weightKg: unknown;
  idempotencyKey: string;
}) {
  const profile = await profileForAction(
    input.actor,
    input.profileId,
    "CREATE",
  );
  if (!isStrictDate(input.measuredOn))
    throw new ValidationError("測定日を確認してください");
  if (!input.idempotencyKey)
    throw new ValidationError("idempotency keyが必要です");
  const standing = toMillimetres(input.heightCm, true)!;
  const weight = toGrams(input.weightKg);
  const keyDigest = tokenDigest(input.idempotencyKey);
  return transaction(async (client) => {
    const existing = await client.query<{
      response_json: Record<string, unknown>;
    }>(
      "SELECT response_json FROM body_growth.idempotency_keys WHERE account_id=$1 AND operation='MEASUREMENT_CREATE' AND key_digest=$2",
      [input.actor.accountId, keyDigest],
    );
    if (existing.rows.length) return existing.rows[0].response_json;
    const inserted = await client.query<{ id: string }>(
      "INSERT INTO body_growth.measurements(profile_id,created_by_account_id) VALUES($1,$2) RETURNING id",
      [profile.id, input.actor.accountId],
    );
    const id = inserted.rows[0].id;
    await client.query(
      "INSERT INTO body_growth.measurement_revisions(measurement_id,version,measured_on,standing_height_mm,weight_g,formula_id,implementation_hash,parameter_hash,created_by_account_id) VALUES($1,1,$2,$3,$4,$5,$6,$7,$8)",
      [
        id,
        input.measuredOn,
        standing,
        weight,
        FORMULA_ID,
        IMPLEMENTATION_HASH,
        PARAMETER_HASH,
        input.actor.accountId,
      ],
    );
    const response = { id, version: 1, status: "ACTIVE" };
    await client.query(
      "INSERT INTO body_growth.idempotency_keys(account_id,operation,key_digest,response_json) VALUES($1,'MEASUREMENT_CREATE',$2,$3)",
      [input.actor.accountId, keyDigest, JSON.stringify(response)],
    );
    await audit(
      client,
      input.actor.accountId,
      "MEASUREMENT_CREATED",
      "MEASUREMENT",
      id,
      { version: 1 },
    );
    return response;
  });
}

export async function mutateMeasurement(input: {
  actor: ActorContext;
  measurementId: string;
  action: "CORRECT" | "VOID";
  expectedVersion: number;
  measuredOn?: string;
  heightCm?: unknown;
  weightKg?: unknown;
  reason?: string;
}) {
  const current = await query<{
    id: string;
    profile_id: string;
    status: "ACTIVE" | "VOIDED";
    version: number;
    created_by_account_id: string;
  }>(
    "SELECT id,profile_id,status,version,created_by_account_id FROM body_growth.measurements WHERE id=$1",
    [input.measurementId],
  );
  if (!current.length) throw new HiddenResourceError("not found");
  const row = current[0];
  await profileForAction(input.actor, row.profile_id, input.action);
  return transaction(async (client) => {
    const lock = await client.query<typeof row>(
      "SELECT id,profile_id,status,version,created_by_account_id FROM body_growth.measurements WHERE id=$1 FOR UPDATE",
      [row.id],
    );
    const measurement = lock.rows[0];
    if (measurement.version !== input.expectedVersion)
      throw new ConflictError(
        "他の更新が反映されています。再読み込みしてください",
      );
    if (input.action === "CORRECT") {
      if (measurement.status !== "ACTIVE")
        throw new ConflictError("無効化済み測定は訂正できません");
      if (
        !input.measuredOn ||
        !isStrictDate(input.measuredOn) ||
        !input.reason?.trim()
      )
        throw new ValidationError("測定日と訂正理由が必要です");
      const next = measurement.version + 1;
      await client.query(
        "INSERT INTO body_growth.measurement_revisions(measurement_id,version,measured_on,standing_height_mm,weight_g,formula_id,implementation_hash,parameter_hash,correction_reason,created_by_account_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
        [
          measurement.id,
          next,
          input.measuredOn,
          toMillimetres(input.heightCm, true),
          toGrams(input.weightKg),
          FORMULA_ID,
          IMPLEMENTATION_HASH,
          PARAMETER_HASH,
          input.reason.trim(),
          input.actor.accountId,
        ],
      );
      await client.query(
        "UPDATE body_growth.measurements SET version=$2 WHERE id=$1",
        [measurement.id, next],
      );
      await audit(
        client,
        input.actor.accountId,
        "MEASUREMENT_CORRECTED",
        "MEASUREMENT",
        measurement.id,
        { fromVersion: measurement.version, toVersion: next },
      );
      return { id: measurement.id, version: next, status: "ACTIVE" };
    }
    if (input.action === "VOID") {
      if (measurement.status !== "ACTIVE")
        throw new ConflictError("すでに無効化されています");
      const next = measurement.version + 1;
      await client.query(
        "UPDATE body_growth.measurements SET status='VOIDED',version=$2,voided_at=now(),voided_by_account_id=$3 WHERE id=$1",
        [measurement.id, next, input.actor.accountId],
      );
      await audit(
        client,
        input.actor.accountId,
        "MEASUREMENT_VOIDED",
        "MEASUREMENT",
        measurement.id,
        {
          fromVersion: measurement.version,
          toVersion: next,
          reason: input.reason?.trim() || null,
        },
      );
      return { id: measurement.id, version: next, status: "VOIDED" };
    }
    throw new HiddenResourceError("not found");
  });
}
