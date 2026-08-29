import { createHash } from "node:crypto";
import type { FormulaSex } from "./types";

export const FORMULA_ID = "MOORE_2015_HEIGHT_ONLY_MATURITY_OFFSET_V1";
export const IMPLEMENTATION_HASH = "4e74c34b2e7ae1ee8ede32a7cce431836f85e771ab21f9939eaa293fe2a32e54";
export const PARAMETER_HASH = "d908f01461b90e7a17a794ab648a23d49b89bf7eb9e485bf29c1f80d3f64c6d2";
export const CANONICAL_IMPLEMENTATION_ARTIFACT = "moore-2015-height-only-v1|age=calendar-month-decimal|female=intercept+ageHeight*ageYears*heightCm|male=intercept+ageHeight*ageYears*heightCm|pre=offset<-1|during=-1<=offset<=1|post=offset>1";
export const CANONICAL_PARAMETER_ARTIFACT = "formulaId=MOORE_2015_HEIGHT_ONLY_MATURITY_OFFSET_V1|ageMin=7.5|ageMax=17.5|femaleIntercept=-7.709133|femaleAgeHeight=0.0042232|maleIntercept=-7.999994|maleAgeHeight=0.0036124";
const IMPLEMENTATION_ARTIFACT_LOCK = "b3be29e50bc20b1c8fd07752584555a721b91392df25cff1d0f6215ffd34c220";
const PARAMETER_ARTIFACT_LOCK = "1b9656ddff1f4ae700ef1080000b3e3b643fc2969d7f1459f2dbe14349fbf5a4";
const PARAMETERS = {
  ageMin:7.5, ageMax:17.5,
  female:{intercept:-7.709133,ageHeight:0.0042232},
  male:{intercept:-7.999994,ageHeight:0.0036124},
} as const;
export const SAFETY_NOTICE = "この表示は身長と年齢から計算した参考であり、医療診断、将来身長予測、練習や選抜の判断には使用できません。懸念がある場合は医療専門家へ相談してください。";

export type GrowthStage = "成長スパート前" | "成長スパート期" | "成長スパート後";
export type MissingReason =
  | "生年月日未入力"
  | "formula区分未登録"
  | "対象年齢外"
  | "身長未登録"
  | "身長値不正"
  | "計算定義未確認";

export interface FormulaDefinition {
  formulaId: string;
  implementationHash: string;
  parameterHash: string;
}

export const VERIFIED_DEFINITION: FormulaDefinition = {
  formulaId: FORMULA_ID,
  implementationHash: IMPLEMENTATION_HASH,
  parameterHash: PARAMETER_HASH,
};

export function isDefinitionVerified(definition: FormulaDefinition): boolean {
  return verifyCanonicalArtifacts()
    && definition.formulaId === FORMULA_ID
    && definition.implementationHash === IMPLEMENTATION_HASH
    && definition.parameterHash === PARAMETER_HASH;
}

export function verifyCanonicalArtifacts(
  implementation=CANONICAL_IMPLEMENTATION_ARTIFACT,
  parameters=CANONICAL_PARAMETER_ARTIFACT,
):boolean {
  return digest(implementation)===IMPLEMENTATION_ARTIFACT_LOCK
    && digest(parameters)===PARAMETER_ARTIFACT_LOCK;
}

export function decimalAge(birthDate: string, measuredAt: string): number {
  if(!isStrictDate(birthDate) || !isStrictDate(measuredAt)) return Number.NaN;
  const birth = new Date(`${birthDate}T00:00:00Z`);
  const measured = new Date(`${measuredAt}T00:00:00Z`);
  if (!Number.isFinite(birth.getTime()) || !Number.isFinite(measured.getTime()) || measured < birth) {
    return Number.NaN;
  }
  let months = (measured.getUTCFullYear() - birth.getUTCFullYear()) * 12
    + measured.getUTCMonth() - birth.getUTCMonth();
  let anchor = new Date(Date.UTC(
    birth.getUTCFullYear(),
    birth.getUTCMonth() + months,
    birth.getUTCDate(),
  ));
  if (measured < anchor) {
    months -= 1;
    anchor = new Date(Date.UTC(birth.getUTCFullYear(), birth.getUTCMonth() + months, birth.getUTCDate()));
  }
  const next = new Date(Date.UTC(birth.getUTCFullYear(), birth.getUTCMonth() + months + 1, birth.getUTCDate()));
  const monthFraction = (measured.getTime() - anchor.getTime()) / (next.getTime() - anchor.getTime());
  return (months + monthFraction) / 12;
}

function isStrictDate(value:string):boolean {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date=new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10)===value;
}

export function stageFromOffset(offset: number): GrowthStage {
  if (offset < -1) return "成長スパート前";
  if (offset <= 1) return "成長スパート期";
  return "成長スパート後";
}

export function offsetFor(ageYears: number, heightCm: number, formulaSex: FormulaSex): number {
  return formulaSex === "female"
    ? PARAMETERS.female.intercept + PARAMETERS.female.ageHeight * ageYears * heightCm
    : PARAMETERS.male.intercept + PARAMETERS.male.ageHeight * ageYears * heightCm;
}

export function growthReference(input: {
  birthDate?: string | null;
  birthDateSelfReported: boolean;
  measuredAt: string;
  heightMm?: number | null;
  formulaSex?: FormulaSex | null;
  definition?: FormulaDefinition;
}): { stage?: GrowthStage; reason?: MissingReason; formulaId?:string; implementationHash?:string; parameterHash?:string } {
  if (!isDefinitionVerified(input.definition ?? VERIFIED_DEFINITION)) return { reason: "計算定義未確認" };
  if (!input.birthDate || !input.birthDateSelfReported) return { reason: "生年月日未入力" };
  if (!input.formulaSex) return { reason: "formula区分未登録" };
  if (!input.heightMm) return { reason: "身長未登録" };
  if(input.heightMm<500 || input.heightMm>2500) return { reason:"身長値不正" };
  const age = decimalAge(input.birthDate, input.measuredAt);
  if (!Number.isFinite(age) || age < PARAMETERS.ageMin || age > PARAMETERS.ageMax) return { reason: "対象年齢外" };
  return {
    stage: stageFromOffset(offsetFor(age, input.heightMm / 10, input.formulaSex)),
    formulaId:FORMULA_ID,implementationHash:IMPLEMENTATION_HASH,parameterHash:PARAMETER_HASH,
  };
}

export function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}