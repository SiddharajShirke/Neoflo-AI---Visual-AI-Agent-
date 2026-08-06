import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const root = process.cwd();
const eventSchemaPath = join(root, 'schemas', 'events', 'browser-event.v1.schema.json');
const batchSchemaPath = join(root, 'schemas', 'events', 'browser-event-batch.v1.schema.json');
const responseSchemaPath = join(
  root,
  'schemas',
  'events',
  'event-ingestion-response.v1.schema.json'
);
const outputPath = join(root, 'packages', 'contracts', 'src', 'generated', 'browser-event.ts');
const checkOnly = process.argv.includes('--check');

const eventSchema = JSON.parse(readFileSync(eventSchemaPath, 'utf8'));
const batchSchema = JSON.parse(readFileSync(batchSchemaPath, 'utf8'));
const responseSchema = JSON.parse(readFileSync(responseSchemaPath, 'utf8'));

function typeFor(schema) {
  if (schema.enum) return schema.enum.map((value) => `'${value}'`).join(' | ');
  if (schema.type === 'array') {
    const reference = schema.items?.$ref;
    if (!reference) throw new Error('Only referenced array-item schemas are supported.');
    return `${reference
      .split('/')
      .at(-1)
      .replace('.v1.schema.json', '')
      .replaceAll('-', ' ')
      .replace(/\b\w/g, (character) => character.toUpperCase())
      .replaceAll(' ', '')}[]`;
  }
  if (schema.type === 'integer' || schema.type === 'number') return 'number';
  if (Array.isArray(schema.type))
    return (
      schema.type
        .filter((type) => type !== 'null')
        .map(typeFor)
        .join(' | ') + ' | null'
    );
  return 'string';
}

function interfaceFor(name, schema) {
  const required = new Set(schema.required ?? []);
  const fields = Object.entries(schema.properties)
    .map(
      ([field, fieldSchema]) =>
        `  ${field}${required.has(field) ? '' : '?'}: ${typeFor(fieldSchema)};`
    )
    .join('\n');
  return `export interface ${name} {\n${fields}\n}`;
}

const eventKind = typeFor(eventSchema.properties.event_kind);
const generated = `/* This file is generated from schemas/events/browser-event.v1.schema.json and browser-event-batch.v1.schema.json. DO NOT EDIT. */

export type BrowserEventKind = ${eventKind};

${interfaceFor('BrowserEvent', eventSchema)}

${interfaceFor('BrowserEventBatch', batchSchema)}

${interfaceFor('EventIngestionResponse', responseSchema)}
`;

if (checkOnly) {
  let actual = '';
  try {
    actual = readFileSync(outputPath, 'utf8');
  } catch {
    throw new Error('Generated contract artifact is missing. Run `pnpm contracts:generate`.');
  }
  if (actual !== generated) {
    throw new Error('Generated contract artifact drifted. Run `pnpm contracts:generate`.');
  }
  console.log('Contract artifact drift check passed.');
} else {
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, generated, 'utf8');
  console.log('Generated packages/contracts/src/generated/browser-event.ts');
}
