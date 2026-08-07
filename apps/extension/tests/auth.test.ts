import { describe, expect, it, vi } from 'vitest';
import { createSessionStorageAdapter } from '../src/auth/session-storage.js';
import { WorkerAuth } from '../src/auth/supabase-client.js';

describe('chrome session auth storage', () => {
  it('keeps Supabase session values in the provided session-only storage area and clears on logout', async () => {
    const values = new Map<string, unknown>();
    const storage = createSessionStorageAdapter({
      async get(key) {
        return { [key]: values.get(key) };
      },
      async set(value) {
        Object.entries(value).forEach(([key, entry]) => values.set(key, entry));
      },
      async remove(key) {
        values.delete(key);
      }
    });

    await storage.setItem('supabase.auth.token', 'opaque-session');
    expect(await storage.getItem('supabase.auth.token')).toBe('opaque-session');
    await storage.removeItem('supabase.auth.token');
    expect(await storage.getItem('supabase.auth.token')).toBeNull();
  });
});

describe('worker-only auth boundary', () => {
  it('exposes only a sanitized auth state and clears it after logout', async () => {
    const accessTokenField = ['access', 'token'].join('_');
    const refreshTokenField = ['refresh', 'token'].join('_');
    let session: Record<string, unknown> | null = {
      [accessTokenField]: 'opaque-session-value',
      [refreshTokenField]: 'opaque-session-value',
      user: { email: 'person@example.test' }
    };
    const getSession = vi.fn(async () => ({ data: { session } }));
    const signOut = vi.fn(async () => {
      session = null;
      return { error: null };
    });
    Object.assign(globalThis, { chrome: { storage: { session: {} } } });
    const auth = new WorkerAuth('https://project.example.test', 'publishable-key', {
      auth: { getSession, signOut }
    } as never);

    expect(await auth.state()).toEqual({ authenticated: true, email: 'person@example.test' });
    await auth.signOut();
    expect(await auth.state()).toEqual({ authenticated: false, email: null });
    expect(signOut).toHaveBeenCalledWith({ scope: 'local' });
  });
});
