import { z } from 'zod';

export const DisplayModeSchema = z.enum(['off', 'wired', 'tablet', 'both']);
export type DisplayMode = z.infer<typeof DisplayModeSchema>;

export const CustomerDisplayPhaseSchema = z.enum([
  'idle',
  'live',
  'countdown',
  'capturing',
  'preview',
  'review',
  'complete',
  'recovering'
]);
export type CustomerDisplayPhase = z.infer<typeof CustomerDisplayPhaseSchema>;

const DisplayBoundsSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
  width: z.number().int().positive(),
  height: z.number().int().positive()
});

export const DisplayTargetSchema = z.object({
  fingerprint: z.string().min(1).max(512),
  id: z.number().int(),
  label: z.string().max(200),
  bounds: DisplayBoundsSchema,
  size: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive()
  }),
  scaleFactor: z.number().positive().finite(),
  rotation: z.number().int(),
  internal: z.boolean(),
  primary: z.boolean()
});
export type DisplayTarget = z.infer<typeof DisplayTargetSchema>;

function isPrivateOrLoopbackIpv4(value: string): boolean {
  const parts = value.split('.');
  if (parts.length !== 4) return false;
  const octets = parts.map((part) => Number(part));
  if (
    octets.some(
      (octet, index) =>
        !Number.isInteger(octet) || octet < 0 || octet > 255 || String(octet) !== parts[index]
    )
  ) {
    return false;
  }
  const [a, b] = octets as [number, number, number, number];
  return (
    a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

export const DisplaySettingsSchema = z.object({
  mode: DisplayModeSchema.default('off'),
  preferredWiredDisplay: DisplayTargetSchema.nullable().default(null),
  tabletBindAddress: z
    .string()
    .refine(isPrivateOrLoopbackIpv4, 'A private IPv4 address is required')
    .nullable()
    .default(null),
  tabletPort: z.number().int().min(1024).max(65_535).default(47_940),
  mirroredLiveView: z.boolean().default(true)
});
export type DisplaySettings = z.infer<typeof DisplaySettingsSchema>;

export const CustomerDisplaySnapshotSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    phase: CustomerDisplayPhaseSchema,
    sessionGeneration: z.number().int().nonnegative(),
    sessionId: z.string().uuid().nullable(),
    shotIndex: z.number().int().nonnegative().nullable(),
    shotCount: z.number().int().min(0).max(12),
    countdownValue: z.number().int().min(1).max(3).nullable(),
    message: z.string().max(200),
    mirroredLiveView: z.boolean(),
    liveFrameSequence: z.number().int().nonnegative().nullable(),
    previewFrameSequence: z.number().int().nonnegative().nullable(),
    updatedAt: z.string().datetime()
  })
  .superRefine((value, ctx) => {
    if ((value.phase === 'countdown') !== (value.countdownValue !== null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['countdownValue'],
        message: 'countdownValue must be present only during countdown'
      });
    }
    if (value.shotCount === 0 && value.shotIndex !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['shotIndex'],
        message: 'shotIndex must be null when shotCount is zero'
      });
    }
    if (
      value.shotIndex !== null &&
      (value.shotCount === 0 || value.shotIndex >= value.shotCount)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['shotIndex'],
        message: 'shotIndex must address an existing shot'
      });
    }
  });
export type CustomerDisplaySnapshot = z.infer<typeof CustomerDisplaySnapshotSchema>;

export const CustomerDisplayFrameMetaSchema = z.object({
  protocolVersion: z.literal(1),
  kind: z.enum(['live', 'preview']),
  sequence: z.number().int().nonnegative().max(0xffff_ffff),
  capturedAtMs: z.number().nonnegative().finite(),
  byteLength: z.number().int().positive().max(8 * 1024 * 1024)
});
export type CustomerDisplayFrameMeta = z.infer<typeof CustomerDisplayFrameMetaSchema>;

export const WiredDisplayStatusSchema = z.object({
  state: z.enum(['closed', 'opening', 'active', 'missing', 'ambiguous', 'error']),
  selectedFingerprint: z.string().nullable(),
  error: z.string().nullable()
});
export type WiredDisplayStatus = z.infer<typeof WiredDisplayStatusSchema>;

export const TabletDisplayStatusSchema = z
  .object({
    state: z.enum([
      'stopped',
      'listening',
      'awaiting_pairing',
      'paired',
      'reconnecting',
      'error'
    ]),
    enabled: z.boolean(),
    host: z.string().nullable(),
    port: z.number().int().min(1024).max(65_535).nullable(),
    pairingUrl: z.string().url().nullable(),
    pairingQrDataUrl: z.string().startsWith('data:image/png;base64,').nullable(),
    lastHeartbeatAt: z.string().datetime().nullable(),
    error: z.string().nullable()
  })
  .superRefine((value, ctx) => {
    if (value.state === 'paired' && (value.pairingUrl !== null || value.pairingQrDataUrl !== null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['pairingUrl'],
        message: 'Pairing credentials must be hidden after pairing'
      });
    }
  });
export type TabletDisplayStatus = z.infer<typeof TabletDisplayStatusSchema>;

export const DisplayStreamMetricsSchema = z.object({
  framesPublished: z.number().int().nonnegative(),
  framesDropped: z.number().int().nonnegative(),
  framesPerSecond: z.number().nonnegative().finite(),
  lastFrameAgeMs: z.number().nonnegative().finite().nullable()
});
export type DisplayStreamMetrics = z.infer<typeof DisplayStreamMetricsSchema>;

export const PrivateNetworkInterfaceSchema = z.object({
  name: z.string().min(1).max(200),
  address: z.string().refine(isPrivateOrLoopbackIpv4, 'A private IPv4 address is required'),
  internal: z.boolean()
});
export type PrivateNetworkInterface = z.infer<typeof PrivateNetworkInterfaceSchema>;

export const DisplayOverviewSchema = z.object({
  settings: DisplaySettingsSchema,
  targets: z.array(DisplayTargetSchema),
  interfaces: z.array(PrivateNetworkInterfaceSchema).default([]),
  wired: WiredDisplayStatusSchema,
  tablet: TabletDisplayStatusSchema,
  metrics: DisplayStreamMetricsSchema
});
export type DisplayOverview = z.infer<typeof DisplayOverviewSchema>;

export const DisplayFingerprintIpcRequestSchema = z.object({
  fingerprint: z.string().min(1).max(512)
});
export type DisplayFingerprintIpcRequest = z.infer<typeof DisplayFingerprintIpcRequestSchema>;

export const StartTabletDisplayIpcRequestSchema = z.object({
  host: z.string().refine(isPrivateOrLoopbackIpv4, 'A private IPv4 address is required'),
  port: z.number().int().min(1024).max(65_535).default(47_940)
});
export type StartTabletDisplayIpcRequest = z.infer<typeof StartTabletDisplayIpcRequestSchema>;

export const SaveDisplaySettingsIpcRequestSchema = DisplaySettingsSchema;
export type SaveDisplaySettingsIpcRequest = DisplaySettings;
