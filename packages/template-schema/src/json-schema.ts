import { zodToJsonSchema } from 'zod-to-json-schema';
import { TemplateDefinitionSchema, TemplateSchema, TemplateVersionSchema } from './definition.js';

export const TemplateDefinitionJsonSchema = zodToJsonSchema(TemplateDefinitionSchema, {
  name: 'TemplateDefinition',
  $refStrategy: 'none'
});

export const TemplateJsonSchema = zodToJsonSchema(TemplateSchema, {
  name: 'Template',
  $refStrategy: 'none'
});

export const TemplateVersionJsonSchema = zodToJsonSchema(TemplateVersionSchema, {
  name: 'TemplateVersion',
  $refStrategy: 'none'
});
