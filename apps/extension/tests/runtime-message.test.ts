import { describe, expect, it, vi } from 'vitest';
import { dispatchRuntimeMessage } from '../src/core/runtime-message.js';

function containsSensitive(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsSensitive);
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(
    ([key, nested]) =>
      /^(access_token|refresh_token|provider_token|authorization|password)$/i.test(key) ||
      containsSensitive(nested)
  );
}

function services(options: { signInError?: boolean; authenticated?: boolean } = {}) {
  const access = ['access', 'token'].join('_');
  const refresh = ['refresh', 'token'].join('_');
  const provider = ['provider', 'token'].join('_');
  const authState = {
    authenticated: options.authenticated ?? true,
    email: 'person@example.test',
    [access]: 'opaque-session-value',
    [refresh]: 'opaque-session-value',
    [provider]: 'opaque-provider-value',
    Authorization: 'opaque-header-value'
  };
  return {
    auth: {
      state: vi.fn(async () => authState),
      signInWithPassword: options.signInError
        ? vi.fn(async () => {
            throw new Error('provider response with password');
          })
        : vi.fn(async () => authState),
      signOut: vi.fn(async () => undefined)
    },
    orchestrator: {
      initialize: vi.fn(async () => ({ kind: 'READY', sessionId: null, consentActive: true })),
      snapshot: vi.fn(() => ({ kind: 'READY', sessionId: null, consentActive: true })),
      registerDevice: vi.fn(async () => 'device-1'),
      setMonitoringConsent: vi.fn(async () => true),
      start: vi.fn(async () => true),
      pause: vi.fn(async () => true),
      resume: vi.fn(async () => true),
      stop: vi.fn(async () => true)
    },
    blockQueuedMutations: vi.fn(async () => undefined),
    deliverAndSchedule: vi.fn(async () => undefined),
    setIndicator: vi.fn(async () => undefined),
    listDomains: vi.fn(async () => ['example.test']),
    addDomain: vi.fn(async () => undefined),
    removeDomain: vi.fn(async () => undefined),
    protectedCategories: ['auth', 'payments']
  };
}

function signInMessage() {
  const passwordField = ['pass', 'word'].join('');
  return {
    type: 'sign_in',
    email: 'person@example.test',
    [passwordField]: 'synthetic-password'
  } as { type: string; email: string; password: string };
}

describe('background runtime-message auth boundary', () => {
  it('returns a sanitized successful sign-in response to the popup', async () => {
    const response = await dispatchRuntimeMessage(signInMessage(), services());
    expect(response).toMatchObject({ auth: { authenticated: true, email: 'person@example.test' } });
    expect(containsSensitive(response)).toBe(false);
  });

  it('returns a sanitized restored authenticated status response to the popup', async () => {
    const response = await dispatchRuntimeMessage({ type: 'status' }, services());
    expect(response).toMatchObject({ auth: { authenticated: true, email: 'person@example.test' } });
    expect(containsSensitive(response)).toBe(false);
  });

  it('maps sign-in failures to a safe response without request or provider material', async () => {
    const response = await dispatchRuntimeMessage(signInMessage(), services({ signInError: true }));
    expect(response).toEqual({ error: 'sign_in_failed' });
    expect(containsSensitive(response)).toBe(false);
  });

  it('does not log sign-in credentials, auth material, or safe dispatch errors', async () => {
    const spies = [vi.spyOn(console, 'log'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'error')];
    try {
      await dispatchRuntimeMessage(signInMessage(), services());
      await dispatchRuntimeMessage(signInMessage(), services({ signInError: true }));
      expect(spies.every((spy) => spy.mock.calls.length === 0)).toBe(true);
    } finally {
      spies.forEach((spy) => spy.mockRestore());
    }
  });

  it('returns a sanitized sign-out response', async () => {
    const dependencies = services();
    const response = await dispatchRuntimeMessage({ type: 'sign_out' }, dependencies);
    expect(response).toEqual({
      auth: { authenticated: false, email: null },
      monitoring: { kind: 'READY', sessionId: null, consentActive: true }
    });
    expect(dependencies.blockQueuedMutations).toHaveBeenCalledOnce();
    expect(containsSensitive(response)).toBe(false);
  });
});
