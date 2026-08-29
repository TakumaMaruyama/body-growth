import { describe, expect, it, vi } from "vitest";
import {
  correctRecord,
  IdempotencyStore,
  voidRecord,
} from "../../apps/api/src/body-growth-lib/domain-model";

const initial = {
  status: "ACTIVE" as const,
  version: 1,
  revisions: [{ version: 1, value: { height: 1500 }, reason: null }],
};

describe("immutable measurement history", () => {
  it("adds a revision rather than replacing history", () => {
    const next = correctRecord(initial, 1, { height: 1510 }, "remeasured");
    expect(next.revisions.map((revision) => revision.value.height)).toEqual([
      1500, 1510,
    ]);
    expect(next.version).toBe(2);
  });

  it("rejects stale versions and retains history when voided", () => {
    expect(() => correctRecord(initial, 0, { height: 1510 }, "reason")).toThrow(
      "VERSION_CONFLICT",
    );
    expect(voidRecord(initial, 1)).toMatchObject({
      status: "VOIDED",
      revisions: initial.revisions,
    });
  });

  it("deduplicates an idempotency key", () => {
    const store = new IdempotencyStore<number>();
    const work = vi.fn(() => 7);
    expect(store.execute("same", work)).toBe(7);
    expect(store.execute("same", work)).toBe(7);
    expect(work).toHaveBeenCalledOnce();
  });
});