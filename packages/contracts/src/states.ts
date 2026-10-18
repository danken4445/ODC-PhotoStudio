import { z } from 'zod';

export const CaptureStateSchema = z.enum([
  'created',
  'capturing',
  'reviewing',
  'approved',
  'cancelled'
]);
export type CaptureState = z.infer<typeof CaptureStateSchema>;

export const CompositeStateSchema = z.enum([
  'pending',
  'rendering',
  'ready',
  'failed'
]);
export type CompositeState = z.infer<typeof CompositeStateSchema>;

export const PrintAttemptStateSchema = z.enum([
  'queued',
  'submitting',
  'submitted',
  'confirmed',
  'failed',
  'unknown',
  'cancelled'
]);
export type PrintAttemptState = z.infer<typeof PrintAttemptStateSchema>;

export const UploadStateSchema = z.enum([
  'pending',
  'registering',
  'uploading',
  'verifying',
  'published',
  'retry_scheduled',
  'blocked_auth',
  'failed',
  'expired'
]);
export type UploadState = z.infer<typeof UploadStateSchema>;

export const DeletionStateSchema = z.enum([
  'not_due',
  'due',
  'deleting',
  'retry_scheduled',
  'deleted'
]);
export type DeletionState = z.infer<typeof DeletionStateSchema>;

export type StateTrackName = 'capture' | 'composite' | 'print' | 'upload' | 'deletion';

export interface StateTransitionRecord {
  id: string;
  sessionId: string;
  track: StateTrackName;
  fromState: string;
  toState: string;
  reason: string;
  transitionedAt: string;
}

const CAPTURE_TRANSITIONS: Record<CaptureState, readonly CaptureState[]> = {
  created: ['capturing', 'cancelled'],
  capturing: ['reviewing', 'capturing', 'cancelled'],
  reviewing: ['capturing', 'approved', 'cancelled'],
  approved: [],
  cancelled: []
};

const COMPOSITE_TRANSITIONS: Record<CompositeState, readonly CompositeState[]> = {
  pending: ['rendering', 'failed'],
  rendering: ['ready', 'failed'],
  ready: [],
  failed: ['rendering', 'pending']
};

const PRINT_ATTEMPT_TRANSITIONS: Record<PrintAttemptState, readonly PrintAttemptState[]> = {
  queued: ['submitting', 'cancelled', 'failed'],
  submitting: ['submitted', 'confirmed', 'failed', 'unknown'],
  submitted: ['confirmed', 'failed', 'unknown'],
  confirmed: [],
  failed: [],
  unknown: ['confirmed', 'failed', 'cancelled'],
  cancelled: []
};

const UPLOAD_TRANSITIONS: Record<UploadState, readonly UploadState[]> = {
  pending: ['registering', 'blocked_auth', 'expired', 'failed'],
  registering: ['uploading', 'retry_scheduled', 'blocked_auth', 'expired', 'failed'],
  uploading: ['verifying', 'retry_scheduled', 'blocked_auth', 'expired', 'failed'],
  verifying: ['published', 'retry_scheduled', 'blocked_auth', 'expired', 'failed'],
  retry_scheduled: ['registering', 'uploading', 'verifying', 'blocked_auth', 'expired', 'failed'],
  blocked_auth: ['pending', 'registering', 'uploading', 'verifying', 'expired', 'failed'],
  published: ['expired'],
  failed: ['pending', 'registering', 'expired'],
  expired: []
};

const DELETION_TRANSITIONS: Record<DeletionState, readonly DeletionState[]> = {
  not_due: ['due', 'deleting'],
  due: ['deleting'],
  deleting: ['deleted', 'retry_scheduled'],
  retry_scheduled: ['deleting', 'deleted'],
  deleted: []
};

export function canTransitionCapture(from: CaptureState, to: CaptureState): boolean {
  return CAPTURE_TRANSITIONS[from]?.includes(to) ?? false;
}

export function canTransitionComposite(from: CompositeState, to: CompositeState): boolean {
  return COMPOSITE_TRANSITIONS[from]?.includes(to) ?? false;
}

export function canTransitionPrintAttempt(from: PrintAttemptState, to: PrintAttemptState): boolean {
  return PRINT_ATTEMPT_TRANSITIONS[from]?.includes(to) ?? false;
}

export function canTransitionUpload(from: UploadState, to: UploadState): boolean {
  return UPLOAD_TRANSITIONS[from]?.includes(to) ?? false;
}

export function canTransitionDeletion(from: DeletionState, to: DeletionState): boolean {
  return DELETION_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertValidTransition(
  track: StateTrackName,
  fromState: string,
  toState: string
): void {
  let valid = false;
  switch (track) {
    case 'capture':
      valid = canTransitionCapture(fromState as CaptureState, toState as CaptureState);
      break;
    case 'composite':
      valid = canTransitionComposite(fromState as CompositeState, toState as CompositeState);
      break;
    case 'print':
      valid = canTransitionPrintAttempt(fromState as PrintAttemptState, toState as PrintAttemptState);
      break;
    case 'upload':
      valid = canTransitionUpload(fromState as UploadState, toState as UploadState);
      break;
    case 'deletion':
      valid = canTransitionDeletion(fromState as DeletionState, toState as DeletionState);
      break;
  }

  if (!valid) {
    throw new Error(
      `Invalid state transition on track [${track}]: cannot transition from "${fromState}" to "${toState}"`
    );
  }
}
