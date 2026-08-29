import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Request } from "express";

export const SESSION_COOKIE = "bg_session";
export const CSRF_COOKIE = "bg_csrf";

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function tokenDigest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function assertTrustedMutation(request: Request): void {
  const origin = request.get("origin");
  const host = request.get("host");
  if (!origin || !host || new URL(origin).host !== host) {
    throw Object.assign(new Error("forbidden"), { status: 403 });
  }
  const cookie = request.cookies?.[CSRF_COOKIE];
  const header = request.get("x-csrf-token");
  if (!cookie || !header || !safeEqual(cookie, header)) {
    throw Object.assign(new Error("forbidden"), { status: 403 });
  }
}

export function clientFingerprint(request: Request): string {
  const forwarded = request.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  return tokenDigest(forwarded);
}