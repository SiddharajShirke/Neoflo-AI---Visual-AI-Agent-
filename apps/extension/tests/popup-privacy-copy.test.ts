import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const popupHtml = readFileSync(
  resolve(import.meta.dirname, '../src/entrypoints/popup/index.html'),
  'utf8'
);

describe('popup privacy copy', () => {
  it('describes local navigation exclusion enforcement without exposing browsing data', () => {
    expect(popupHtml).toContain(
      'Local exclusions are applied before a top-level navigation event is stored.'
    );
    expect(popupHtml).not.toContain('enforce exclusions in Milestone 3');
    expect(popupHtml).not.toContain('current browser URLs');
  });
});
