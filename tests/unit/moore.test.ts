import { describe, expect, it } from "vitest";
import {
  CANONICAL_IMPLEMENTATION_ARTIFACT,
  growthReference,
  offsetFor,
  SAFETY_NOTICE,
  stageFromOffset,
  VERIFIED_DEFINITION,
  verifyCanonicalArtifacts,
} from "../../apps/api/src/body-growth-lib/moore";

describe("Moore 2015 height-only reference", () => {
  it("locks both published sex-specific equations", () => {
    expect(offsetFor(12, 150, "female")).toBeCloseTo(
      -7.709133 + 0.0042232 * 12 * 150,
      12,
    );
    expect(offsetFor(14, 170, "male")).toBeCloseTo(
      -7.999994 + 0.0036124 * 14 * 170,
      12,
    );
  });

  it("includes -1 and 1 in the growth-spurt stage", () => {
    expect(stageFromOffset(-1.000001)).toBe("成長スパート前");
    expect(stageFromOffset(-1)).toBe("成長スパート期");
    expect(stageFromOffset(1)).toBe("成長スパート期");
    expect(stageFromOffset(1.000001)).toBe("成長スパート後");
  });

  it("includes ages 7.5 and 17.5", () => {
    expect(growthReference({
      birthDate: "2010-01-01",
      birthDateSelfReported: true,
      measuredAt: "2017-07-01",
      heightMm: 1300,
      formulaSex: "female",
    }).stage).toBeDefined();
    expect(growthReference({
      birthDate: "2010-01-01",
      birthDateSelfReported: true,
      measuredAt: "2027-07-01",
      heightMm: 1800,
      formulaSex: "male",
    }).stage).toBeDefined();
  });

  it("fails closed for missing inputs and unverified definitions", () => {
    expect(growthReference({
      birthDate: null,
      birthDateSelfReported: false,
      measuredAt: "2020-01-01",
      heightMm: 1500,
      formulaSex: "female",
    }).reason).toBe("生年月日未入力");
    expect(growthReference({
      birthDate: "2010-01-01",
      birthDateSelfReported: true,
      measuredAt: "2022-01-01",
      heightMm: 1500,
      formulaSex: "female",
      definition: { ...VERIFIED_DEFINITION, parameterHash: "wrong" },
    }).reason).toBe("計算定義未確認");
  });

  it("verifies canonical artifacts and keeps the safety warning", () => {
    expect(verifyCanonicalArtifacts()).toBe(true);
    expect(
      verifyCanonicalArtifacts(`${CANONICAL_IMPLEMENTATION_ARTIFACT}|changed`),
    ).toBe(false);
    for (const phrase of ["医療診断", "将来身長予測", "選抜", "医療専門家"]) {
      expect(SAFETY_NOTICE).toContain(phrase);
    }
  });
});