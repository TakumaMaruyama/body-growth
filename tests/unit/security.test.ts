import { describe, expect, it } from "vitest";
import {
  assertTrustedMutation,
  CSRF_COOKIE,
} from "../../apps/api/src/body-growth-lib/security";
import { RATE_LIMIT_POLICY } from "../../apps/api/src/body-growth-lib/rate-limit-policy";
import { databaseSslConfig } from "../../apps/api/src/body-growth-lib/db-config";

function request(
  origin: string,
  host: string,
  cookieToken?: string,
  headerToken?: string,
): Parameters<typeof assertTrustedMutation>[0] {
  const headers: Record<string, string | undefined> = {
    origin,
    host,
    "x-csrf-token": headerToken,
  };
  return {
    cookies: cookieToken ? { [CSRF_COOKIE]: cookieToken } : {},
    get: (name: string) => headers[name.toLowerCase()],
  } as Parameters<typeof assertTrustedMutation>[0];
}

describe("mutation defenses", () => {
  it("requires a same-origin request and matching CSRF tokens", () => {
    expect(() =>
      assertTrustedMutation(request("https://example.test", "example.test", "same", "same"))
    ).not.toThrow();
    expect(() =>
      assertTrustedMutation(request("https://evil.test", "example.test", "same", "same"))
    ).toThrow();
    expect(() =>
      assertTrustedMutation(request("https://example.test", "example.test", "a", "b"))
    ).toThrow();
  });

  it("defines limits for all sensitive operations", () => {
    for (const policy of Object.values(RATE_LIMIT_POLICY)) {
      expect(policy.max).toBeGreaterThan(0);
      expect(policy.seconds).toBeGreaterThan(0);
    }
  });
});

describe("database transport security", () => {
  it("enables certificate verification in production", () => {
    expect(databaseSslConfig({ NODE_ENV: "development" })).toBeUndefined();
    expect(databaseSslConfig({ NODE_ENV: "production" })).toBe(true);
    expect(
      databaseSslConfig({
        NODE_ENV: "production",
        DATABASE_SSL_CA: "trusted-ca-line-1\\ntrusted-ca-line-2",
      }),
    ).toEqual({
      ca: "trusted-ca-line-1\ntrusted-ca-line-2",
      rejectUnauthorized: true,
    });
  });
});