import { describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiClientError } from '../src/api/client.js';

const navigationBatch = {
  device_id: '10000000-0000-4000-8000-0000000000a1',
  session_id: '10000000-0000-4000-8000-0000000000a2',
  events: [
    {
      client_event_id: '10000000-0000-4000-8000-0000000000a3',
      sequence_number: 1,
      event_kind: 'navigation' as const,
      occurred_at: '2026-08-08T00:00:00.000Z',
      page_domain: 'example.com',
      transition_type: 'link' as const,
      capture_policy_version: 'm4-navigation-v1'
    }
  ]
};

const consent = {
  device_id: '10000000-0000-0000-0000-0000000000a1',
  scope: 'monitoring' as const,
  policy_version: 'm3-monitoring-v1',
  granted: true
};

describe('control-plane API client', () => {
  it('exposes only the approved fixed control-plane operations', () => {
    const client = new ApiClient(
      'https://api.example.test',
      async () => null,
      async () => false,
      vi.fn()
    );
    expect(Object.getOwnPropertyNames(Object.getPrototypeOf(client)).sort()).toEqual(
      [
        'cancelSession',
        'completeSession',
        'constructor',
        'createConsent',
        'createSession',
        'getSession',
        'listConsents',
        'listDevices',
        'listSessions',
        'ingestBrowserEventBatch',
        'pauseSession',
        'registerDevice',
        'requestSessionDeletion',
        'resumeSession',
        'revokeDevice'
      ].sort()
    );
    expect(ApiClient.toString()).not.toMatch(/\/(?:internal|outbox|queue)(?:\/|['"`])/i);
  });

  it('posts only a valid v2 navigation batch with send-time auth and a stable idempotency key', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ accepted_count: 1, duplicate_count: 0 }), { status: 200 })
      );
    const client = new ApiClient(
      'https://api.example.test',
      async () => 'access-token',
      async () => false,
      fetcher
    );

    await expect(client.ingestBrowserEventBatch(navigationBatch, 'batch-key')).resolves.toEqual({
      accepted_count: 1,
      duplicate_count: 0
    });
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.example.test/api/v1/events/batch',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token',
          'Idempotency-Key': 'batch-key'
        }),
        body: JSON.stringify(navigationBatch)
      })
    );
  });

  it('rejects a v1-shaped or prohibited browser-event payload before sending', async () => {
    const fetcher = vi.fn();
    const client = new ApiClient(
      'https://api.example.test',
      async () => 'access-token',
      async () => false,
      fetcher
    );

    expect(() =>
      client.ingestBrowserEventBatch(
        {
          ...navigationBatch,
          events: [{ ...navigationBatch.events[0], url: 'https://secret.test' }]
        } as never,
        'batch-key'
      )
    ).toThrow('invalid_request_contract');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('does not turn a refreshable 401 into a second physical browser-event POST', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ error: { code: 'expired' } }), { status: 401 })
      );
    const refresh = vi.fn().mockResolvedValue(true);
    const client = new ApiClient('https://api.example.test', async () => 'token', refresh, fetcher);

    await expect(
      client.ingestBrowserEventBatch(navigationBatch, 'batch-key')
    ).rejects.toMatchObject({
      status: 401,
      code: 'authentication_refreshed'
    });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('reads the server-confirmed capture policy only from the compatible session authority header', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ id: '10000000-0000-4000-8000-0000000000a2', status: 'recording' }),
          { status: 200, headers: { 'X-Capture-Policy-Version': 'm4-navigation-v1' } }
        )
      );
    const client = new ApiClient(
      'https://api.example.test',
      async () => 'access-token',
      async () => false,
      fetcher
    );

    await expect(client.getSession('10000000-0000-4000-8000-0000000000a2')).resolves.toEqual({
      id: '10000000-0000-4000-8000-0000000000a2',
      status: 'recording',
      capturePolicyVersion: 'm4-navigation-v1'
    });
  });

  it('treats a malformed capture-policy authority header as unavailable', async () => {
    const client = new ApiClient(
      'https://api.example.test',
      async () => 'access-token',
      async () => false,
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ id: '10000000-0000-4000-8000-0000000000a2', status: 'recording' }),
            { status: 200, headers: { 'X-Capture-Policy-Version': 'too long policy value' } }
          )
        )
    );

    await expect(client.getSession('10000000-0000-4000-8000-0000000000a2')).resolves.toMatchObject({
      capturePolicyVersion: null
    });
  });

  it('sends a canonical consent request with an idempotency key and validates its response', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: '20000000-0000-0000-0000-0000000000a1',
          scope: 'monitoring',
          granted: 'true'
        }),
        { status: 201 }
      )
    );
    const client = new ApiClient(
      'https://api.example.test',
      async () => 'access-token',
      async () => true,
      fetcher
    );
    await expect(client.createConsent(consent, 'operation-1')).resolves.toMatchObject({
      granted: 'true'
    });
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.example.test/api/v1/consents',
      expect.objectContaining({
        headers: expect.objectContaining({ 'Idempotency-Key': 'operation-1' })
      })
    );
  });

  it('refreshes once on 401 and signs no request without a replacement token', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: { code: 'invalid_token', message: 'x', request_id: 'r' } }),
          { status: 401 }
        )
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ devices: [] }), { status: 200 }));
    const refresh = vi.fn().mockResolvedValue(true);
    const client = new ApiClient(
      'https://api.example.test',
      async () => 'access-token',
      refresh,
      fetcher
    );
    await expect(client.listDevices()).resolves.toEqual({ devices: [] });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('rejects malformed API responses with a safe error', async () => {
    const client = new ApiClient(
      'https://api.example.test',
      async () => 'access-token',
      async () => true,
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ devices: [], access_token: 'leak' }), { status: 200 })
        )
    );
    await expect(client.listDevices()).rejects.toBeInstanceOf(ApiClientError);
  });

  it('exposes only sanitized API error metadata when a response body is unsafe', async () => {
    const client = new ApiClient(
      'https://api.example.test',
      async () => 'opaque-session-value',
      async () => false,
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ diagnostic: 'opaque-provider-detail' }), { status: 500 })
        )
    );
    await expect(client.listDevices()).rejects.toMatchObject({ status: 500, code: 'api_error' });
    await client.listDevices().catch((error: ApiClientError) => {
      expect(Object.keys(error).sort()).toEqual(['code', 'retryAfter', 'status']);
      expect(JSON.stringify(error)).not.toContain('opaque-provider-detail');
      expect(JSON.stringify(error)).not.toContain('opaque-session-value');
    });
  });

  it('reuses the idempotency key for the one permitted 401 retry', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { code: 'expired' } }), { status: 401 })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: '20000000-0000-0000-0000-0000000000a1',
            scope: 'monitoring',
            granted: 'true'
          }),
          {
            status: 201
          }
        )
      );
    const client = new ApiClient(
      'https://api.example.test',
      async () => 'token',
      async () => true,
      fetcher
    );
    await client.createConsent(consent, 'stable-operation-id');
    expect(fetcher).toHaveBeenCalledTimes(2);
    for (const [, init] of fetcher.mock.calls)
      expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe(
        'stable-operation-id'
      );
  });

  it.each([
    [async () => false, 'refresh failure'],
    [async () => true, 'second unauthorized response']
  ])('enters authentication-required error after %s', async (refresh) => {
    const client = new ApiClient(
      'https://api.example.test',
      async () => 'token',
      refresh,
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ error: { code: 'invalid_token' } }), { status: 401 })
        )
    );
    await expect(client.listDevices()).rejects.toMatchObject({
      status: 401,
      code: 'authentication_required'
    });
  });
});
