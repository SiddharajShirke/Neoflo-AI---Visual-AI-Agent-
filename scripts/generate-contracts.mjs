import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { format } from 'prettier';
import prettierConfig from '../prettier.config.mjs';

const root = process.cwd();
const checkOnly = process.argv.includes('--check');
const eventSchemaPath = join(root, 'schemas', 'events', 'browser-event.v1.schema.json');
const batchSchemaPath = join(root, 'schemas', 'events', 'browser-event-batch.v1.schema.json');
const eventResponseSchemaPath = join(
  root,
  'schemas',
  'events',
  'event-ingestion-response.v1.schema.json'
);
const eventOutputPath = join(root, 'packages', 'contracts', 'src', 'generated', 'browser-event.ts');
const controlOutputPath = join(
  root,
  'packages',
  'contracts',
  'src',
  'generated',
  'control-plane.ts'
);
const controlSchemaFiles = [
  'device-register-request.v1.schema.json',
  'device-register-response.v1.schema.json',
  'device-list-response.v1.schema.json',
  'consent-create-request.v1.schema.json',
  'consent-create-response.v1.schema.json',
  'consent-list-response.v1.schema.json',
  'monitoring-session-create-request.v1.schema.json',
  'monitoring-session-response.v1.schema.json',
  'monitoring-session-create-response.v1.schema.json',
  'monitoring-session-list-response.v1.schema.json',
  'session-transition-response.v1.schema.json',
  'deletion-request-response.v1.schema.json',
  'error-response.v1.schema.json'
];

function readSchema(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function typeFor(schema) {
  if (typeof schema.$ref === 'string') {
    return schema.$ref
      .split('/')
      .at(-1)
      .replace('.v1.schema.json', '')
      .replaceAll('-', ' ')
      .replace(/\b\w/g, (character) => character.toUpperCase())
      .replaceAll(' ', '');
  }
  if (Object.hasOwn(schema, 'const')) return JSON.stringify(schema.const);
  if (schema.enum) return schema.enum.map((value) => JSON.stringify(value)).join(' | ');
  if (Array.isArray(schema.type)) {
    return (
      schema.type
        .filter((type) => type !== 'null')
        .map((type) => typeFor({ ...schema, type }))
        .join(' | ') + ' | null'
    );
  }
  if (schema.type === 'array') return `${typeFor(schema.items)}[]`;
  if (schema.type === 'object') {
    const required = new Set(schema.required ?? []);
    const fields = Object.entries(schema.properties ?? {})
      .map(
        ([field, fieldSchema]) =>
          `${JSON.stringify(field)}${required.has(field) ? '' : '?'}: ${typeFor(fieldSchema)}`
      )
      .join('; ');
    return `{ ${fields} }`;
  }
  if (schema.type === 'integer' || schema.type === 'number') return 'number';
  if (schema.type === 'boolean') return 'boolean';
  return 'string';
}

function interfaceFor(name, schema) {
  return `export type ${name} = ${typeFor(schema)};`;
}

function eventInterfaceFor(name, schema) {
  const required = new Set(schema.required ?? []);
  const fields = Object.entries(schema.properties)
    .map(
      ([field, fieldSchema]) =>
        `  ${field}${required.has(field) ? '' : '?'}: ${typeFor(fieldSchema)};`
    )
    .join('\n');
  return `export interface ${name} {\n${fields}\n}`;
}

async function writeOrCheck(path, generated) {
  const formatted = await format(generated, { ...prettierConfig, parser: 'typescript' });
  if (checkOnly) {
    let actual = '';
    try {
      actual = readFileSync(path, 'utf8');
    } catch {
      throw new Error(
        `Generated contract artifact is missing: ${path}. Run \`pnpm contracts:generate\`.`
      );
    }
    if (actual !== formatted) {
      throw new Error(
        `Generated contract artifact drifted: ${path}. Run \`pnpm contracts:generate\`.`
      );
    }
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, formatted, 'utf8');
  console.log(`Generated ${path.replace(`${root}/`, '').replaceAll('\\', '/')}`);
}

const eventSchema = readSchema(eventSchemaPath);
const batchSchema = readSchema(batchSchemaPath);
const eventResponseSchema = readSchema(eventResponseSchemaPath);
const eventGenerated = `/* This file is generated from schemas/events/browser-event.v1.schema.json and browser-event-batch.v1.schema.json. DO NOT EDIT. */\n\nexport type BrowserEventKind = ${typeFor(eventSchema.properties.event_kind)};\n\n${eventInterfaceFor('BrowserEvent', eventSchema)}\n\n${eventInterfaceFor('BrowserEventBatch', batchSchema)}\n\n${eventInterfaceFor('EventIngestionResponse', eventResponseSchema)}\n`;

const controlSchemas = Object.fromEntries(
  controlSchemaFiles.map((file) => {
    const schema = readSchema(join(root, 'schemas', 'api', file));
    return [schema.title, schema];
  })
);
const controlTypes = Object.entries(controlSchemas)
  .map(([name, schema]) => interfaceFor(name, schema))
  .join('\n\n');
const controlValidators = Object.keys(controlSchemas)
  .map(
    (name) =>
      `export function is${name}(value: unknown): value is ${name} {\n  return matchesSchema(value, schemas.${name});\n}`
  )
  .join('\n\n');
const controlGenerated = `/* This file is generated from versioned schemas/api control-plane contracts. DO NOT EDIT. */\n\n${controlTypes}\n\ntype Schema = Record<string, unknown>;\n\nconst schemas = ${JSON.stringify(controlSchemas, null, 2)} as const;\n\nfunction isRecord(value: unknown): value is Record<string, unknown> {\n  return typeof value === 'object' && value !== null && !Array.isArray(value);\n}\n\nfunction matchesSchema(value: unknown, schema: Schema): boolean {\n  if (Object.hasOwn(schema, 'const') && value !== schema.const) return false;\n  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) return false;\n  const allowedTypes = Array.isArray(schema.type) ? schema.type : [schema.type];\n  if (!allowedTypes.some((type) => matchesType(value, type, schema))) return false;\n  if (typeof value === 'string') {\n    if (typeof schema.minLength === 'number' && value.length < schema.minLength) return false;\n    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) return false;\n    if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern).test(value)) return false;\n    if (schema.format === 'uuid' && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) return false;\n    if (schema.format === 'date-time' && Number.isNaN(Date.parse(value))) return false;\n  }\n  if (typeof value === 'number') {\n    if (typeof schema.minimum === 'number' && value < schema.minimum) return false;\n    if (typeof schema.maximum === 'number' && value > schema.maximum) return false;\n  }\n  if (Array.isArray(value) && isRecord(schema.items)) return value.every((item) => matchesSchema(item, schema.items));\n  if (isRecord(value) && schema.type === 'object') {\n    const properties = isRecord(schema.properties) ? schema.properties : {};\n    const required = Array.isArray(schema.required) ? schema.required : [];\n    if (required.some((field) => typeof field !== 'string' || !(field in value))) return false;\n    if (schema.additionalProperties === false && Object.keys(value).some((field) => !(field in properties))) return false;\n    return Object.entries(properties).every(([field, fieldSchema]) =>\n      !(field in value) || (isRecord(fieldSchema) && matchesSchema(value[field], fieldSchema))\n    );\n  }\n  return true;\n}\n\nfunction matchesType(value: unknown, type: unknown, schema: Schema): boolean {\n  if (type === 'null') return value === null;\n  if (type === 'string') return typeof value === 'string';\n  if (type === 'boolean') return typeof value === 'boolean';\n  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);\n  if (type === 'integer') return Number.isInteger(value);\n  if (type === 'array') return Array.isArray(value);\n  if (type === 'object') return isRecord(value);\n  return schema.type === undefined;\n}\n\n${controlValidators}\n`;

const typedControlGenerated = controlGenerated.replace(
  'matchesSchema(item, schema.items)',
  'matchesSchema(item, schema.items as Schema)'
);

await writeOrCheck(eventOutputPath, eventGenerated);
await writeOrCheck(controlOutputPath, typedControlGenerated);
if (checkOnly) console.log('Contract artifact drift check passed.');
