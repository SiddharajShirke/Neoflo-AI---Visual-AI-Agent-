import { describe, expect, it } from 'vitest';
import { dashboardTitle } from '../app/constants.js';

describe('dashboard foundation page', () => {
  it('identifies the application shell', () => {
    expect(dashboardTitle).toBe('Visual AI Browser Agent');
  });
});
