import { z } from 'zod';
import { AssetRefSchema, FontAssetRefSchema, ImageAssetRefSchema, Sha256Schema } from './assets.js';

export const CURRENT_TEMPLATE_SCHEMA_VERSION = 1 as const;
export const FIXED_POINT_SCALE = 10_000 as const;

export const PaperSizeSchema = z.enum(['4x6', '2x6-strip', '5x7', 'custom']);
export type PaperSize = z.infer<typeof PaperSizeSchema>;

export const OrientationSchema = z.enum(['portrait', 'landscape']);
export type Orientation = z.infer<typeof OrientationSchema>;

export const RectSchema = z
  .object({
    x: z.number().int().nonnegative(),
    y: z.number().int().nonnegative(),
    width: z.number().int().positive(),
    height: z.number().int().positive()
  })
  .strict();
export type Rect = z.infer<typeof RectSchema>;

export const CutLineSchema = z.object({ y: z.number().int().positive() }).strict();
export type CutLine = z.infer<typeof CutLineSchema>;

export const CanvasSchema = z
  .object({
    paper: PaperSizeSchema,
    widthPx: z.number().int().positive().max(60_000),
    heightPx: z.number().int().positive().max(60_000),
    dpi: z.literal(300),
    bleedPx: z.number().int().nonnegative(),
    safeAreaPx: z.number().int().nonnegative(),
    orientation: OrientationSchema,
    cutLines: z.array(CutLineSchema).max(16).optional()
  })
  .strict()
  .superRefine((canvas, ctx) => {
    if (canvas.safeAreaPx > Math.min(canvas.widthPx, canvas.heightPx) / 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['safeAreaPx'],
        message: 'safeAreaPx must leave usable space on both axes'
      });
    }

    for (const [index, cutLine] of (canvas.cutLines ?? []).entries()) {
      if (cutLine.y >= canvas.heightPx) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['cutLines', index, 'y'],
          message: 'Cut lines must fall inside the canvas'
        });
      }
    }
  });
export type Canvas = z.infer<typeof CanvasSchema>;

export const FocalPointSchema = z
  .object({
    x: z.number().int().min(0).max(FIXED_POINT_SCALE),
    y: z.number().int().min(0).max(FIXED_POINT_SCALE)
  })
  .strict();
export type FocalPoint = z.infer<typeof FocalPointSchema>;

export const FilterPresetSchema = z.enum(['none', 'grayscale', 'sepia', 'warm', 'cool']);
export type FilterPreset = z.infer<typeof FilterPresetSchema>;

const LayerBaseSchema = z.object({
  id: z.string().min(1).max(120).regex(/^[a-zA-Z0-9_-]+$/),
  frame: RectSchema
});

export const PhotoSlotLayerSchema = LayerBaseSchema.extend({
  type: z.literal('photoSlot'),
  rotation: z.number().int().min(-360).max(360),
  fit: z.enum(['cover', 'contain']),
  shotIndex: z.number().int().nonnegative().max(99),
  focalPoint: FocalPointSchema,
  mask: ImageAssetRefSchema.optional(),
  filter: FilterPresetSchema.default('none')
}).strict();
export type PhotoSlotLayer = z.infer<typeof PhotoSlotLayerSchema>;

export const OverlayLayerSchema = LayerBaseSchema.extend({
  type: z.literal('overlay'),
  asset: ImageAssetRefSchema.refine(
    (asset) => asset.kind === 'overlay' || asset.kind === 'image',
    'Overlay layers require an overlay or image asset'
  ),
  opacity: z.number().int().min(0).max(FIXED_POINT_SCALE)
}).strict();
export type OverlayLayer = z.infer<typeof OverlayLayerSchema>;

export const TemplateTokenSchema = z.enum([
  '{{event.name}}',
  '{{event.date}}',
  '{{session.number}}',
  '{{client.name}}'
]);
export type TemplateToken = z.infer<typeof TemplateTokenSchema>;

export const TextContentSchema = z.string().max(2_000);
export const TextLayerSchema = LayerBaseSchema.extend({
  type: z.literal('text'),
  content: TextContentSchema,
  fontAsset: FontAssetRefSchema,
  size: z.number().int().positive().max(2_000),
  color: z.string().regex(/^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/),
  align: z.enum(['left', 'center', 'right'])
}).strict();
export type TextLayer = z.infer<typeof TextLayerSchema>;

export const ShapeLayerSchema = LayerBaseSchema.extend({
  type: z.literal('shape'),
  fill: z.string().regex(/^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/),
  radius: z.number().int().nonnegative().optional()
}).strict();
export type ShapeLayer = z.infer<typeof ShapeLayerSchema>;

export const QrCodeLayerSchema = LayerBaseSchema.extend({
  type: z.literal('qrCode'),
  payload: z.enum(['galleryUrl', 'custom'])
}).strict();
export type QrCodeLayer = z.infer<typeof QrCodeLayerSchema>;

export const LayerSchema = z.discriminatedUnion('type', [
  PhotoSlotLayerSchema,
  OverlayLayerSchema,
  TextLayerSchema,
  ShapeLayerSchema,
  QrCodeLayerSchema
]);
export type Layer = z.infer<typeof LayerSchema>;

export const TemplateDefinitionSchema = z
  .object({
    schemaVersion: z.literal(CURRENT_TEMPLATE_SCHEMA_VERSION),
    canvas: CanvasSchema,
    layers: z.array(LayerSchema).min(1).max(128)
  })
  .strict()
  .superRefine((definition, ctx) => {
    const ids = new Set<string>();
    for (const [index, layer] of definition.layers.entries()) {
      if (ids.has(layer.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['layers', index, 'id'],
          message: `Layer id must be unique: ${layer.id}`
        });
      }
      ids.add(layer.id);

      const maxX = layer.frame.x + layer.frame.width;
      const maxY = layer.frame.y + layer.frame.height;
      if (maxX > definition.canvas.widthPx || maxY > definition.canvas.heightPx) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['layers', index, 'frame'],
          message: `Layer ${layer.id} must fit inside the canvas`
        });
      }
    }

    const qrLayers = definition.layers.filter((layer) => layer.type === 'qrCode');
    if (qrLayers.length > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['layers'],
        message: 'A template may contain at most one QR code layer'
      });
    }
  });
export type TemplateDefinition = z.infer<typeof TemplateDefinitionSchema>;

export const TemplateStatusSchema = z.enum(['draft', 'published', 'archived']);
export type TemplateStatus = z.infer<typeof TemplateStatusSchema>;

export const TemplateSchema = z
  .object({
    id: z.string().uuid(),
    clientId: z.string().uuid(),
    name: z.string().min(1).max(120),
    status: TemplateStatusSchema,
    createdBy: z.string().uuid(),
    createdAt: z.string().datetime()
  })
  .strict();
export type Template = z.infer<typeof TemplateSchema>;

export const TemplateVersionSchema = z
  .object({
    id: z.string().uuid(),
    templateId: z.string().uuid(),
    version: z.number().int().positive(),
    schemaVersion: z.literal(CURRENT_TEMPLATE_SCHEMA_VERSION),
    definition: TemplateDefinitionSchema,
    assets: z.array(AssetRefSchema),
    contentHash: Sha256Schema,
    signature: z.string().min(1).optional(),
    publishedBy: z.string().uuid(),
    publishedAt: z.string().datetime()
  })
  .strict()
  .superRefine((version, ctx) => {
    const assetIds = new Set<string>();
    for (const [index, asset] of version.assets.entries()) {
      if (assetIds.has(asset.assetId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['assets', index, 'assetId'],
          message: `Asset must appear once in a version: ${asset.assetId}`
        });
      }
      assetIds.add(asset.assetId);
    }
  });
export type TemplateVersion = z.infer<typeof TemplateVersionSchema>;
