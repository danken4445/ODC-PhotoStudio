import sharp from 'sharp';
import QRCode from 'qrcode';
import {
  computeBufferSha256,
  TemplateDefinitionSchema,
  type PrintProfile,
  type TemplateDefinition
} from '@odc-photostudio/contracts';
import {
  calculateRotatedSlotPlacement,
  calculateSourceCoverCrop
} from './geometry.js';

export interface RenderCompositeInput {
  template: TemplateDefinition;
  shotBuffersByIndex: ReadonlyMap<number, Buffer>;
  overlayBuffer: Buffer;
  galleryUrl: string;
}

export interface RenderCompositeResult {
  compositeBuffer: Buffer;
  width: number;
  height: number;
  sha256: string;
  byteSize: number;
}

export async function generateHighContrastQrBuffer(params: {
  url: string;
  sizePx: number;
  quietZoneModules: number;
}): Promise<Buffer> {
  if (params.quietZoneModules < 4) {
    throw new Error('QR quiet zone must be at least 4 modules');
  }
  const rawQrPng = await QRCode.toBuffer(params.url, {
    type: 'png',
    width: params.sizePx,
    margin: params.quietZoneModules,
    errorCorrectionLevel: 'M',
    color: {
      dark: '#000000',
      light: '#FFFFFF'
    }
  });

  // Normalize to exact sizePx x sizePx in sRGB
  return sharp(rawQrPng)
    .toColorspace('srgb')
    .resize(params.sizePx, params.sizePx, {
      fit: 'fill',
      kernel: 'nearest'
    })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

export async function normalizeApprovedShotToSrgbJpeg(inputBuffer: Buffer): Promise<{
  buffer: Buffer;
  width: number;
  height: number;
  sha256: string;
  byteSize: number;
}> {
  // Normalize EXIF orientation, convert to sRGB, strip EXIF/metadata
  const normalized = await sharp(inputBuffer)
    .rotate()
    .toColorspace('srgb')
    .jpeg({ quality: 92, mozjpeg: false, chromaSubsampling: '4:4:4' })
    .toBuffer({ resolveWithObject: true });

  return {
    buffer: normalized.data,
    width: normalized.info.width,
    height: normalized.info.height,
    sha256: computeBufferSha256(normalized.data),
    byteSize: normalized.data.byteLength
  };
}

/**
 * Deterministic compositor:
 * 1. Validates template schema and overlay SHA-256 hash.
 * 2. Normalizes each required shot orientation and sRGB color space.
 * 3. Applies documented CLIP_BEFORE_ROTATION_AROUND_SLOT_CENTER rule for each slot.
 * 4. Composites slots beneath the verified transparent PNG overlay.
 * 5. Places the high-contrast QR code in its reserved box on top so it is never covered.
 * 6. Strips EXIF metadata and returns deterministic JPEG output with checksum.
 */
export async function renderCompositeImage(
  input: RenderCompositeInput
): Promise<RenderCompositeResult> {
  const template = TemplateDefinitionSchema.parse(input.template);

  // Verify overlay hash matches template definition
  const actualOverlayHash = computeBufferSha256(input.overlayBuffer);
  if (actualOverlayHash.toLowerCase() !== template.overlay.sha256.toLowerCase()) {
    throw new Error(
      `Overlay SHA-256 mismatch: expected ${template.overlay.sha256}, got ${actualOverlayHash}`
    );
  }

  // Verify overlay dimensions match canvas
  const overlayMeta = await sharp(input.overlayBuffer).metadata();
  if (
    overlayMeta.width !== template.canvas.widthPx ||
    overlayMeta.height !== template.canvas.heightPx
  ) {
    throw new Error(
      `Overlay dimensions (${overlayMeta.width}x${overlayMeta.height}) do not match canvas (${template.canvas.widthPx}x${template.canvas.heightPx})`
    );
  }

  const compositeLayers: sharp.OverlayOptions[] = [];

  for (const slot of template.slots) {
    const rawShot = input.shotBuffersByIndex.get(slot.photoIndex);
    if (!rawShot) {
      throw new Error(`Missing required shot buffer for photoIndex ${slot.photoIndex}`);
    }

    // Step 1: Normalize orientation and sRGB
    const oriented = await sharp(rawShot)
      .rotate()
      .toColorspace('srgb')
      .toBuffer({ resolveWithObject: true });

    let clippedSlotBuffer: Buffer;
    if (slot.fit === 'cover') {
      const crop = calculateSourceCoverCrop(
        oriented.info.width,
        oriented.info.height,
        slot
      );
      clippedSlotBuffer = await sharp(oriented.data)
        .extract(crop)
        .resize(slot.width, slot.height, { fit: 'fill' })
        .png()
        .toBuffer();
    } else {
      clippedSlotBuffer = await sharp(oriented.data)
        .resize(slot.width, slot.height, {
          fit: 'contain',
          background: { r: 255, g: 255, b: 255, alpha: 1 }
        })
        .png()
        .toBuffer();
    }

    // Step 2: Rotate around slot center if rotationDeg !== 0
    if (slot.rotationDeg !== 0) {
      const rotatedBuffer = await sharp(clippedSlotBuffer)
        .rotate(slot.rotationDeg, {
          background: { r: 0, g: 0, b: 0, alpha: 0 }
        })
        .png()
        .toBuffer();
      const placement = calculateRotatedSlotPlacement(slot);
      compositeLayers.push({
        input: rotatedBuffer,
        left: placement.compositeLeft,
        top: placement.compositeTop
      });
    } else {
      compositeLayers.push({
        input: clippedSlotBuffer,
        left: slot.x,
        top: slot.y
      });
    }
  }

  // Step 3: Place overlay over photo slots
  compositeLayers.push({
    input: input.overlayBuffer,
    left: 0,
    top: 0
  });

  // Step 4: Generate and place QR code in reserved high-contrast box
  const qrBuffer = await generateHighContrastQrBuffer({
    url: input.galleryUrl,
    sizePx: template.qr.sizePx,
    quietZoneModules: template.qr.quietZoneModules
  });

  compositeLayers.push({
    input: qrBuffer,
    left: template.qr.x,
    top: template.qr.y
  });

  // Step 5: Render onto canvas background and output deterministic sRGB JPEG without EXIF
  const finalImage = await sharp({
    create: {
      width: template.canvas.widthPx,
      height: template.canvas.heightPx,
      channels: 4,
      background: template.backgroundColor
    }
  })
    .composite(compositeLayers)
    .toColorspace('srgb')
    .jpeg({ quality: 95, mozjpeg: false, chromaSubsampling: '4:4:4' })
    .toBuffer({ resolveWithObject: true });

  return {
    compositeBuffer: finalImage.data,
    width: finalImage.info.width,
    height: finalImage.info.height,
    sha256: computeBufferSha256(finalImage.data),
    byteSize: finalImage.data.byteLength
  };
}

/**
 * Applies printer profile strip imposition when a 2x6 strip (600x1800)
 * needs to be duplicated side-by-side onto a 4x6 media sheet (1200x1800).
 */
export async function applyPrintImposition(
  compositeBuffer: Buffer,
  profile: PrintProfile
): Promise<{ buffer: Buffer; width: number; height: number }> {
  const meta = await sharp(compositeBuffer).metadata();
  if (!meta.width || !meta.height) {
    throw new Error('Unable to read composite dimensions for print imposition');
  }

  if (
    profile.paperSize === '2x6_strip' &&
    profile.stripImposition === 'duplicate_2x6_on_4x6'
  ) {
    if (meta.width !== 600 || meta.height !== 1800) {
      throw new Error(
        `2x6 strip imposition requires 600x1800 composite, received ${meta.width}x${meta.height}`
      );
    }
    const imposed = await sharp({
      create: {
        width: 1200,
        height: 1800,
        channels: 3,
        background: '#FFFFFF'
      }
    })
      .composite([
        { input: compositeBuffer, left: 0, top: 0 },
        { input: compositeBuffer, left: 600, top: 0 }
      ])
      .toColorspace('srgb')
      .jpeg({ quality: 95, mozjpeg: false })
      .toBuffer({ resolveWithObject: true });

    return {
      buffer: imposed.data,
      width: imposed.info.width,
      height: imposed.info.height
    };
  }

  return {
    buffer: compositeBuffer,
    width: meta.width,
    height: meta.height
  };
}
