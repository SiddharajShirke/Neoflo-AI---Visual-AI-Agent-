import { describe, expect, it } from 'vitest';
import { extensionName, permissions } from '../src/manifest.js';
import config from '../wxt.config.js';

describe('extension foundation manifest', () => {
  it('starts with no browser-data permissions', () => {
    expect(extensionName).toBe('Visual AI Browser Agent');
    expect(permissions).toEqual([]);
  });

  it('uses the source directory for extension entrypoints', () => {
    expect(config.srcDir).toBe('src');
  });
});
