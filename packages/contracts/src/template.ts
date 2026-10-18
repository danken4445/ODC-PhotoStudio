import { z } from 'zod';

export const PhotoSlotSchema = z.object({
  id: z.string().min(1),
  photoIndex: z.number().int().min(0),
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  rotationDeg: z.number().min(-180).max(180),
  fit: z.enum(['cover', 'contain']),
  focalPoint: z.object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1)
  })
});
export type PhotoSlot = z.infer<typeof PhotoSlotSchema>;

export const TemplateCanvasSchema = z.object({
  widthPx: z.number().int().min(300).max(6000),
  heightPx: z.number().int().min(300).max(6000),
  dpi: z.number().int().min(150).max(600)
});

export const TemplatePaperSchema = z.object({
  widthIn: z.number().positive().max(12),
  heightIn: z.number().positive().max(18)
});

export const TemplateOverlaySchema = z.object({
  assetId: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i, 'Overlay SHA-256 must be a 64-character hex string')
});

export const TemplateQrBoxSchema = z.object({
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  sizePx: z.number().int().min(120).max(1200),
  quietZoneModules: z.number().int().min(4).max(16)
});

export const TemplateDefinitionSchema = z
  .object({
    schemaVersion: z.literal(1),
    canvas: TemplateCanvasSchema,
    paper: TemplatePaperSchema,
    requiredShots: z.number().int().min(1).max(12),
    slots: z.array(PhotoSlotSchema).min(1).max(16),
    overlay: TemplateOverlaySchema,
    qr: TemplateQrBoxSchema,
    backgroundColor: z
      .string()
      .regex(/^#[0-9A-Fa-f]{6}$/)
      .default('#FFFFFF'),
    safeMarginPx: z.number().int().min(0).default(24),
    bleedPx: z.number().int().min(0).default(0)
  })
  .superRefine((tpl, ctx) => {
    // 1. Validate physical paper dimensions match canvas pixel dimensions and DPI
    const expectedWidthPx = Math.round(tpl.paper.widthIn * tpl.canvas.dpi);
    const expectedHeightPx = Math.round(tpl.paper.heightIn * tpl.canvas.dpi);
    if (
      Math.abs(tpl.canvas.widthPx - expectedWidthPx) > 2 ||
      Math.abs(tpl.canvas.heightPx - expectedHeightPx) > 2
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Canvas dimensions (${tpl.canvas.widthPx}x${tpl.canvas.heightPx} @ ${tpl.canvas.dpi} DPI) do not match physical paper (${tpl.paper.widthIn}x${tpl.paper.heightIn} in)`
      });
    }

    // 2. Validate QR box stays completely within canvas and safe margins
    if (
      tpl.qr.x < tpl.safeMarginPx ||
      tpl.qr.y < tpl.safeMarginPx ||
      tpl.qr.x + tpl.qr.sizePx > tpl.canvas.widthPx - tpl.safeMarginPx ||
      tpl.qr.y + tpl.qr.sizePx > tpl.canvas.heightPx - tpl.safeMarginPx
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `QR box (${tpl.qr.x},${tpl.qr.y} size ${tpl.qr.sizePx}) clips canvas or violates safe margin (${tpl.safeMarginPx}px)`
      });
    }

    // 3. Validate minimum physical size of QR code (>= 0.5 inches on print)
    const qrPhysicalInches = tpl.qr.sizePx / tpl.canvas.dpi;
    if (qrPhysicalInches < 0.5) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `QR physical size (${qrPhysicalInches.toFixed(2)} in) is smaller than the minimum scannable 0.50 in requirement`
      });
    }

    // 4. Validate each slot references a valid photoIndex < requiredShots and fits canvas
    for (const slot of tpl.slots) {
      if (slot.photoIndex >= tpl.requiredShots) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Slot "${slot.id}" references photoIndex ${slot.photoIndex}, but requiredShots is ${tpl.requiredShots}`
        });
      }
      if (slot.x + slot.width > tpl.canvas.widthPx || slot.y + slot.height > tpl.canvas.heightPx) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Slot "${slot.id}" exceeds canvas bounds`
        });
      }
      // 5. Reject templates where any photo slot overlaps and covers the reserved QR box
      const overlapsQr =
        slot.x < tpl.qr.x + tpl.qr.sizePx &&
        slot.x + slot.width > tpl.qr.x &&
        slot.y < tpl.qr.y + tpl.qr.sizePx &&
        slot.y + slot.height > tpl.qr.y;
      if (overlapsQr) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Slot "${slot.id}" overlaps reserved QR code region`
        });
      }
    }
  });

export type TemplateDefinition = z.infer<typeof TemplateDefinitionSchema>;

export const PrintProfileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  deviceName: z.string().min(1),
  paperSize: z.enum(['4x6_postcard', '2x6_strip']),
  dpi: z.number().int().min(150).max(600),
  scalingMode: z.literal('exact_1_to_1'),
  offsetXMm: z.number().min(-10).max(10).default(0),
  offsetYMm: z.number().min(-10).max(10).default(0),
  maxCopiesPerSession: z.number().int().min(1).max(10).default(3),
  supportsTwoBySixCut: z.boolean().default(false),
  stripImposition: z.enum(['none', 'duplicate_2x6_on_4x6']).default('none')
});
export type PrintProfile = z.infer<typeof PrintProfileSchema>;
