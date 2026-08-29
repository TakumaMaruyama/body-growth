import type { ActorContext, MeasurementAction } from "./types";

export class HiddenResourceError extends Error {
  status = 404;
}

export function canAccessProfile(
  actor: ActorContext,
  profileId: string,
  action: MeasurementAction,
): boolean {
  if (actor.accountStatus !== "ACTIVE") return false;
  if (actor.role === "ADMIN") return action === "VIEW";
  return actor.role === "USER" && actor.profileId === profileId;
}

export function assertProfileAccess(
  actor: ActorContext,
  profileId: string,
  action: MeasurementAction,
): void {
  if (!canAccessProfile(actor, profileId, action)) {
    throw new HiddenResourceError("not found");
  }
}