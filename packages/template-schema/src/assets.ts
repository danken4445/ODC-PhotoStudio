import { z } from 'zod';

export const Sha256Schema = z
  .string()
  .regex(/^[a-f0-9]{64}$/, 'SHA-256 must be lowercase hexadecimal');
export type Sha256 = z.infer<typeof Sha256Schema>;

export const AssetKindSchema = z.enum(['overlay', 'font', 'image', 'mask']);
export type AssetKind = z.infer<typeof AssetKindSchema>;

export const AssetMimeTypeSchema = z.enum([
  'image/png',
  'image/jpeg',
  'image/webp',
  'font/ttf',
  'font/otf',
  'font/woff2'
]);
export type AssetMimeType = z.infer<typeof AssetMimeTypeSchema>;

const AssetRefBaseSchema = z
  .object({
    assetId: z.string().uuid(),
    kind: AssetKindSchema,
    sha256: Sha256Schema,
    byteSize: z.number().int().positive().max(100 * 1024 * 1024),
    mimeType: AssetMimeTypeSchema,
    widthPx: z.number().int().positive().max(60_000).optional(),
    heightPx: z.number().int().positive().max(60_000).optional(),
    dpi: z.number().int().positive().max(1_200).optional()
  })
  .strict();

function addAssetSemanticIssues(
  asset: z.infer<typeof AssetRefBaseSchema>,
  ctx: z.RefinementCtx
): void {
    const imageKinds = new Set<AssetKind>(['overlay', 'image', 'mask']);
    const imageMimeTypes = new Set<AssetMimeType>(['image/png', 'image/jpeg', 'image/webp']);
    const isImage = imageKinds.has(asset.kind);
    const isImageMime = imageMimeTypes.has(asset.mimeType);

    if (isImage !== isImageMime) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['mimeType'],
        message: `${asset.kind} assets must use an image MIME type and font assets must use a font MIME type`
      });
    }

    if (isImage && (asset.widthPx === undefined || asset.heightPx === undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['widthPx'],
        message: 'Image assets must declare widthPx and heightPx'
      });
    }

    if (asset.kind === 'font' && asset.dpi !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['dpi'],
        message: 'Font assets do not have a DPI value'
      });
    }
}

export const AssetRefSchema = AssetRefBaseSchema.superRefine(addAssetSemanticIssues);
export type AssetRef = z.infer<typeof AssetRefSchema>;

export const FontAssetRefSchema = AssetRefBaseSchema.extend({
  kind: z.literal('font'),
  mimeType: z.enum(['font/ttf', 'font/otf', 'font/woff2'])
}).superRefine(addAssetSemanticIssues);
export type FontAssetRef = z.infer<typeof FontAssetRefSchema>;

export const ImageAssetRefSchema = AssetRefBaseSchema.extend({
  kind: z.enum(['overlay', 'image', 'mask']),
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  widthPx: z.number().int().positive(),
  heightPx: z.number().int().positive()
}).superRefine(addAssetSemanticIssues);
export type ImageAssetRef = z.infer<typeof ImageAssetRefSchema>;
