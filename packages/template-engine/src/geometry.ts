import type { PhotoSlot, TemplateDefinition } from '@odc-photostudio/contracts';
import { TemplateDefinitionSchema } from '@odc-photostudio/contracts';

/**
 * Authoritative Clipping & Rotation Rule (Section 12 / ADR-004):
 * 1. Clip occurs FIRST in the unrotated slot local coordinate space (`slot.width` x `slot.height`)
 *    according to `slot.fit` ('cover' | 'contain') and normalized `slot.focalPoint` (0..1).
 * 2. Rotation (`slot.rotationDeg`) occurs SECOND around the slot center
 *    `(slot.x + slot.width / 2, slot.y + slot.height / 2)`.
 * 3. Both the template editor preview and the Sharp compositor execute this exact rule.
 */
export const CLIPPING_ROTATION_RULE = 'CLIP_BEFORE_ROTATION_AROUND_SLOT_CENTER' as const;

export interface SourceCropRegion {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface RotatedPlacement {
  compositeLeft: number;
  compositeTop: number;
  boundingWidth: number;
  boundingHeight: number;
}

export function calculateSourceCoverCrop(
  sourceWidth: number,
  sourceHeight: number,
  slot: Pick<PhotoSlot, 'width' | 'height' | 'focalPoint'>
): SourceCropRegion {
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    throw new Error('Source image dimensions must be positive');
  }
  const targetAspect = slot.width / slot.height;
  const sourceAspect = sourceWidth / sourceHeight;

  let cropWidth = sourceWidth;
  let cropHeight = sourceHeight;

  if (sourceAspect > targetAspect) {
    cropWidth = Math.max(1, Math.round(sourceHeight * targetAspect));
  } else if (sourceAspect < targetAspect) {
    cropHeight = Math.max(1, Math.round(sourceWidth / targetAspect));
  }

  const maxLeft = Math.max(0, sourceWidth - cropWidth);
  const maxTop = Math.max(0, sourceHeight - cropHeight);

  const focalX = Math.min(1, Math.max(0, slot.focalPoint.x));
  const focalY = Math.min(1, Math.max(0, slot.focalPoint.y));

  const left = Math.round(maxLeft * focalX);
  const top = Math.round(maxTop * focalY);

  return {
    left,
    top,
    width: cropWidth,
    height: cropHeight
  };
}

export function calculateRotatedSlotPlacement(
  slot: Pick<PhotoSlot, 'x' | 'y' | 'width' | 'height' | 'rotationDeg'>
): RotatedPlacement {
  const rad = (Math.abs(slot.rotationDeg) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  const boundingWidth = Math.round(slot.width * cos + slot.height * sin);
  const boundingHeight = Math.round(slot.width * sin + slot.height * cos);

  const centerX = slot.x + slot.width / 2;
  const centerY = slot.y + slot.height / 2;

  const compositeLeft = Math.round(centerX - boundingWidth / 2);
  const compositeTop = Math.round(centerY - boundingHeight / 2);

  return {
    compositeLeft,
    compositeTop,
    boundingWidth,
    boundingHeight
  };
}

export function createDefaultFourBySixPostcardTemplate(params: {
  overlayAssetId: string;
  overlaySha256: string;
}): TemplateDefinition {
  return TemplateDefinitionSchema.parse({
    schemaVersion: 1,
    canvas: { widthPx: 1200, heightPx: 1800, dpi: 300 },
    paper: { widthIn: 4, heightIn: 6 },
    requiredShots: 4,
    slots: [
      {
        id: 'slot-1',
        photoIndex: 0,
        x: 60,
        y: 60,
        width: 510,
        height: 680,
        rotationDeg: 0,
        fit: 'cover',
        focalPoint: { x: 0.5, y: 0.5 }
      },
      {
        id: 'slot-2',
        photoIndex: 1,
        x: 630,
        y: 60,
        width: 510,
        height: 680,
        rotationDeg: 0,
        fit: 'cover',
        focalPoint: { x: 0.5, y: 0.5 }
      },
      {
        id: 'slot-3',
        photoIndex: 2,
        x: 60,
        y: 800,
        width: 510,
        height: 680,
        rotationDeg: 0,
        fit: 'cover',
        focalPoint: { x: 0.5, y: 0.5 }
      },
      {
        id: 'slot-4',
        photoIndex: 3,
        x: 630,
        y: 800,
        width: 510,
        height: 680,
        rotationDeg: 0,
        fit: 'cover',
        focalPoint: { x: 0.5, y: 0.5 }
      }
    ],
    overlay: {
      assetId: params.overlayAssetId,
      sha256: params.overlaySha256
    },
    qr: {
      x: 960,
      y: 1540,
      sizePx: 200,
      quietZoneModules: 4
    },
    backgroundColor: '#FFFFFF',
    safeMarginPx: 24,
    bleedPx: 0
  });
}

export function createDefaultTwoBySixStripTemplate(params: {
  overlayAssetId: string;
  overlaySha256: string;
}): TemplateDefinition {
  return TemplateDefinitionSchema.parse({
    schemaVersion: 1,
    canvas: { widthPx: 600, heightPx: 1800, dpi: 300 },
    paper: { widthIn: 2, heightIn: 6 },
    requiredShots: 3,
    slots: [
      {
        id: 'strip-slot-1',
        photoIndex: 0,
        x: 40,
        y: 50,
        width: 520,
        height: 440,
        rotationDeg: 0,
        fit: 'cover',
        focalPoint: { x: 0.5, y: 0.5 }
      },
      {
        id: 'strip-slot-2',
        photoIndex: 1,
        x: 40,
        y: 520,
        width: 520,
        height: 440,
        rotationDeg: 0,
        fit: 'cover',
        focalPoint: { x: 0.5, y: 0.5 }
      },
      {
        id: 'strip-slot-3',
        photoIndex: 2,
        x: 40,
        y: 990,
        width: 520,
        height: 440,
        rotationDeg: 0,
        fit: 'cover',
        focalPoint: { x: 0.5, y: 0.5 }
      }
    ],
    overlay: {
      assetId: params.overlayAssetId,
      sha256: params.overlaySha256
    },
    qr: {
      x: 200,
      y: 1520,
      sizePx: 200,
      quietZoneModules: 4
    },
    backgroundColor: '#FFFFFF',
    safeMarginPx: 24,
    bleedPx: 0
  });
}
