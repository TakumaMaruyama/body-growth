import bcrypt from "bcryptjs";
import type { Request } from "express";
import { query, transaction } from "./db";
import { SESSION_COOKIE, tokenDigest } from "./security";
import type { ActorContext, Role } from "./types";

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function ensureAdminBootstrap(): Promise<void> {
  const username = process.env.BODY_GROWTH_ADMIN_USERNAME?.trim().toLowerCase();
  const password = process.env.BODY_GROWTH_ADMIN_PASSWORD;
  if (!username || !password) throw new Error("管理者設定が不足しています");
  await transaction(async (client) => {
    await client.query("LOCK TABLE body_growth.accounts IN SHARE ROW EXCLUSIVE MODE");
    const existing = await client.query<{id:string}>("SELECT id FROM body_growth.accounts WHERE role='ADMIN'");
    if (existing.rows.length) return;
    const passwordHash = await hashPassword(password);
    await client.query(
      "INSERT INTO body_growth.accounts(username,password_hash,role) VALUES($1,$2,'ADMIN')",
      [username,passwordHash],
    );
  });
}

export async function getActor(request: Request): Promise<ActorContext | null> {
  const raw = request.cookies?.[SESSION_COOKIE];
  if (!raw) return null;
  const sessions = await query<{
    account_id: string; account_status: "ACTIVE" | "SUSPENDED"; role: Role;
    profile_id:string|null; password_change_required:boolean;
  }>(`
    SELECT s.account_id,a.status account_status,a.role,p.id profile_id,a.password_change_required
    FROM body_growth.sessions s
    JOIN body_growth.accounts a ON a.id=s.account_id
    LEFT JOIN body_growth.profiles p ON p.account_id=a.id
    WHERE s.token_digest=$1 AND s.expires_at>now() AND s.revoked_at IS NULL
      AND a.status='ACTIVE'
  `, [tokenDigest(raw)]);
  if (!sessions.length) return null;
  const base = sessions[0];
  return {
    accountId: base.account_id,
    accountStatus: base.account_status,
    role: base.role,
    profileId: base.profile_id,
    passwordChangeRequired: base.password_change_required,
  };
}