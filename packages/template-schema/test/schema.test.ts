import { describe, expect, it } from 'vitest';
import {
  TemplateDefinitionJsonSchema,
  TemplateDefinitionSchema,
  migrateTemplateDefinition
} from '../src/index.js';

const overlayAsset = {
  assetId: '11111111-1111-4111-8111-111111111111',
  kind: 'overlay' as const,
  sha256: 'a'.repeat(64),
  byteSize: 10_000,
  mimeType: 'image/png' as const,
  widthPx: 1200,
  heightPx: 1800,
  dpi: 300
};

const fontAsset = {
  assetId: '22222222-2222-4222-8222-222222222222',
  kind: 'font' as const,
  sha256: 'b'.repeat(64),
  byteSize: 20_000,
  mimeType: 'font/ttf' as const
};

function validDefinition() {
  return {
    schemaVersion: 1 as const,
    canvas: {
      paper: '4x6' as const,
      widthPx: 1200,
      heightPx: 1800,
      dpi: 300 as const,
      bleedPx: 12,
      safeAreaPx: 24,
      orientation: 'portrait' as const,
      cutLines: [{ y: 900 }]
    },
    layers: [
      {
        type: 'photoSlot' as const,
        id: 'photo-1',
        frame: { x: 24, y: 24, width: 552, height: 800 },
        rotation: 0,
        fit: 'cover' as const,
        shotIndex: 0,
        focalPoint: { x: 5000, y: 5000 },
        filter: 'none' as const
      },
      {
        type: 'text' as const,
        id: 'title',
        frame: { x: 24, y: 840, width: 1152, height: 80 },
        content: '{{event.name}}',
        fontAsset,
        size: 48,
        color: '#FFFFFF',
        align: 'center' as const
      },
      {
        type: 'overlay' as const,
        id: 'overlay',
        frame: { x: 0, y: 0, width: 1200, height: 1800 },
        asset: overlayAsset,
        opacity: 10_000
      }
    ]
  };
}

describe('template-schema', () => {
  it('accepts the canonical integer-based definition and applies defaults', () => {
    const parsed = TemplateDefinitionSchema.parse(validDefinition());
    expect(parsed.layers[0]?.type).toBe('photoSlot');
    expect(parsed.layers[0]?.type === 'photoSlot' && parsed.layers[0].filter).toBe('none');
  });

  it('rejects duplicate ids, fractional geometry, and out-of-bounds layers', () => {
    const definition = validDefinition();
    definition.layers[1] = {
      ...definition.layers[1],
      id: 'photo-1',
      frame: { x: 24.5, y: 840, width: 1152, height: 1200 }
    };

    const result = TemplateDefinitionSchema.safeParse(definition);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.message).join('|')).toContain('Layer id must be unique');
      expect(result.error.issues.map((issue) => issue.message).join('|')).toContain('Layer photo-1 must fit inside the canvas');
    }
  });

  it('exports JSON Schema from the same runtime schema', () => {
    expect(TemplateDefinitionJsonSchema).toMatchObject({
      $schema: 'http://json-schema.org/draft-07/schema#',
      $ref: '#/definitions/TemplateDefinition'
    });
    expect(TemplateDefinitionJsonSchema).toHaveProperty('definitions.TemplateDefinition');
  });

  it('rejects unsupported versions without mutating the input', () => {
    const definition = { ...validDefinition(), schemaVersion: 99 };
    const before = JSON.stringify(definition);
    const result = migrateTemplateDefinition(definition);

    expect(result).toEqual({
      ok: false,
      issues: [{ code: 'unsupported_schema_version', message: 'Unsupported template schema version: 99' }]
    });
    expect(JSON.stringify(definition)).toBe(before);
  });
});
