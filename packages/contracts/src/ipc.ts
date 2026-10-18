import { z } from 'zod';
import {
  CaptureStateSchema,
  CompositeStateSchema,
  DeletionStateSchema,
  PrintAttemptStateSchema,
  UploadStateSchema
} from './states.js';
import { PrintProfileSchema, TemplateDefinitionSchema } from './template.js';

export const CreateSessionIpcRequestSchema = z.object({
  tenantId: z.string().uuid(),
  eventId: z.string().uuid(),
  stationId: z.string().uuid(),
  operatorId: z.string().uuid(),
  templateVersionId: z.string().uuid()
});
export type CreateSessionIpcRequest = z.infer<typeof CreateSessionIpcRequestSchema>;

export const TriggerCaptureIpcRequestSchema = z.object({
  sessionId: z.string().uuid(),
  frameIndex: z.number().int().min(0).max(11)
});
export type TriggerCaptureIpcRequest = z.infer<typeof TriggerCaptureIpcRequestSchema>;

export const ApproveSessionIpcRequestSchema = z.object({
  sessionId: z.string().uuid(),
  selectedShotAssetIdsByIndex: z.record(z.string(), z.string().uuid())
});
export type ApproveSessionIpcRequest = z.infer<typeof ApproveSessionIpcRequestSchema>;

export const SubmitPrintIpcRequestSchema = z.object({
  sessionId: z.string().uuid(),
  printProfileId: z.string().min(1),
  copies: z.number().int().min(1).max(10).default(1),
  isReprint: z.boolean().default(false)
});
export type SubmitPrintIpcRequest = z.infer<typeof SubmitPrintIpcRequestSchema>;

export const ResolveUnknownPrintIpcRequestSchema = z.object({
  attemptId: z.string().uuid(),
  resolution: z.enum(['confirmed', 'failed', 'cancelled']),
  operatorNote: z.string().min(3).max(200)
});
export type ResolveUnknownPrintIpcRequest = z.infer<typeof ResolveUnknownPrintIpcRequestSchema>;

export const SessionSummaryViewSchema = z.object({
  sessionId: z.string().uuid(),
  tenantId: z.string().uuid(),
  eventId: z.string().uuid(),
  stationId: z.string().uuid(),
  operatorId: z.string().uuid(),
  templateVersionId: z.string().uuid(),
  captureState: CaptureStateSchema,
  compositeState: CompositeStateSchema,
  uploadState: UploadStateSchema,
  deletionState: DeletionStateSchema,
  firstCapturedAt: z.string().datetime().nullable(),
  approvedAt: z.string().datetime().nullable(),
  expiresAt: z.string().datetime().nullable(),
  latestPrintAttemptState: PrintAttemptStateSchema.nullable(),
  latestPrintAttemptId: z.string().uuid().nullable()
});
export type SessionSummaryView = z.infer<typeof SessionSummaryViewSchema>;

export const StationPreflightStatusSchema = z.object({
  readyOffline: z.boolean(),
  mode: z.enum(['real', 'mock']),
  simulationLabel: z.string().nullable(),
  grantValid: z.boolean(),
  grantReason: z.string().nullable(),
  assetsVerified: z.boolean(),
  diskSpaceOk: z.boolean(),
  availableBytes: z.number().int().nonnegative(),
  requiredBytes: z.number().int().nonnegative(),
  cameraReady: z.boolean(),
  printerReady: z.boolean(),
  clockHealthy: z.boolean(),
  clockWarningReason: z.string().nullable()
});
export type StationPreflightStatus = z.infer<typeof StationPreflightStatusSchema>;

export { PrintProfileSchema, TemplateDefinitionSchema };
