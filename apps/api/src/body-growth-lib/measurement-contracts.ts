import { z } from "zod";

const expectedVersionSchema = z.coerce.number().int().positive();

export const measurementCreateSchema = z
  .object({
    measuredOn: z.string(),
    heightCm: z.unknown(),
    weightKg: z.unknown().optional(),
    idempotencyKey: z.string(),
  })
  .strict();

export const measurementCorrectionSchema = z
  .object({
    expectedVersion: expectedVersionSchema,
    measuredOn: z.string(),
    heightCm: z.unknown(),
    weightKg: z.unknown().optional(),
    reason: z.string(),
  })
  .strict();

export const measurementVoidSchema = z
  .object({
    expectedVersion: expectedVersionSchema,
    reason: z.string().optional(),
  })
  .strict();
