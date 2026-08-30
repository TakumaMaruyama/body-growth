import { describe, expect, it } from "vitest";
import {
  measurementCorrectionSchema,
  measurementCreateSchema,
  measurementVoidSchema,
} from "../../apps/api/src/body-growth-lib/measurement-contracts";

describe("measurement API contracts", () => {
  it("accepts only height, optional weight, and idempotency data when creating", () => {
    expect(
      measurementCreateSchema.parse({
        measuredOn: "2026-08-30",
        heightCm: 150.2,
        weightKg: 42.8,
        idempotencyKey: "b0e91eb3-408b-4330-b02d-574679368b6e",
      }),
    ).toMatchObject({ heightCm: 150.2, weightKg: 42.8 });
  });

  it("rejects retired sitting-height data for create and correction requests", () => {
    expect(() =>
      measurementCreateSchema.parse({
        measuredOn: "2026-08-30",
        heightCm: 150.2,
        sittingHeightCm: 78.4,
        idempotencyKey: "b0e91eb3-408b-4330-b02d-574679368b6e",
      }),
    ).toThrow();
    expect(() =>
      measurementCorrectionSchema.parse({
        expectedVersion: 1,
        measuredOn: "2026-08-30",
        heightCm: 150.2,
        sittingHeightCm: 78.4,
        reason: "再測定",
      }),
    ).toThrow();
  });

  it("keeps correction and void concurrency contracts explicit", () => {
    expect(
      measurementCorrectionSchema.parse({
        expectedVersion: "2",
        measuredOn: "2026-08-30",
        heightCm: 150.2,
        reason: "再測定",
      }).expectedVersion,
    ).toBe(2);
    expect(
      measurementVoidSchema.parse({ expectedVersion: 2, reason: "入力ミス" }),
    ).toMatchObject({ expectedVersion: 2, reason: "入力ミス" });
  });
});
