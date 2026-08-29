import { describe, expect, it } from "vitest";
import {
  assertProfileAccess,
  canAccessProfile,
  HiddenResourceError,
} from "../../apps/api/src/body-growth-lib/authorization";
import type { ActorContext } from "../../apps/api/src/body-growth-lib/types";

const user: ActorContext = {
  accountId: "u1",
  accountStatus: "ACTIVE",
  role: "USER",
  profileId: "p1",
  passwordChangeRequired: false,
};

describe("personal account authorization", () => {
  it("allows users to access only their own profile", () => {
    for (const action of ["VIEW", "CREATE", "CORRECT", "VOID"] as const) {
      expect(canAccessProfile(user, "p1", action)).toBe(true);
      expect(canAccessProfile(user, "p2", action)).toBe(false);
    }
  });

  it("gives administrators read-only access", () => {
    const admin: ActorContext = {
      ...user,
      accountId: "a1",
      role: "ADMIN",
      profileId: null,
    };
    expect(canAccessProfile(admin, "p1", "VIEW")).toBe(true);
    expect(() => assertProfileAccess(admin, "p1", "VOID")).toThrow(
      HiddenResourceError,
    );
  });

  it("denies suspended accounts", () => {
    expect(
      canAccessProfile({ ...user, accountStatus: "SUSPENDED" }, "p1", "VIEW"),
    ).toBe(false);
  });
});