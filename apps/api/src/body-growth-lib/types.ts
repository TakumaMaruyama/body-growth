export type Role = "USER" | "ADMIN";
export type AccountStatus = "ACTIVE" | "SUSPENDED";
export type MeasurementStatus = "ACTIVE" | "VOIDED";
export type FormulaSex = "female" | "male";

export interface ActorContext {
  accountId: string;
  accountStatus: AccountStatus;
  role: Role;
  profileId: string | null;
  passwordChangeRequired: boolean;
}

export type MeasurementAction = "VIEW" | "CREATE" | "CORRECT" | "VOID";