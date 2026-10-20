import { TemplateDefinitionSchema, CURRENT_TEMPLATE_SCHEMA_VERSION, type TemplateDefinition } from './definition.js';

export type TemplateMigrationIssue = {
  code: 'unsupported_schema_version' | 'invalid_definition';
  message: string;
};

export type TemplateMigrationResult =
  | { ok: true; definition: TemplateDefinition; migrated: boolean }
  | { ok: false; issues: TemplateMigrationIssue[] };

/**
 * Migration entry point. Version 1 is already canonical; future versions add
 * pure transforms here rather than letting callers mutate published JSON.
 */
export function migrateTemplateDefinition(input: unknown): TemplateMigrationResult {
  if (!isRecord(input) || typeof input.schemaVersion !== 'number') {
    return {
      ok: false,
      issues: [{ code: 'invalid_definition', message: 'schemaVersion is required' }]
    };
  }

  if (input.schemaVersion !== CURRENT_TEMPLATE_SCHEMA_VERSION) {
    return {
      ok: false,
      issues: [
        {
          code: 'unsupported_schema_version',
          message: `Unsupported template schema version: ${String(input.schemaVersion)}`
        }
      ]
    };
  }

  const parsed = TemplateDefinitionSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => ({
        code: 'invalid_definition' as const,
        message: `${issue.path.join('.') || 'definition'}: ${issue.message}`
      }))
    };
  }

  return { ok: true, definition: parsed.data, migrated: false };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
