import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { CaptureGate } from '../src/navigation/capture-gate.js';
import { createCommittedNavigationHandler } from '../src/navigation/committed-navigation-handler.js';
import { NavigationDuplicateCache } from '../src/navigation/duplicate-cache.js';
import { openControlPlaneDatabase } from '../src/persistence/database.js';
import { normalizeNavigationUrl } from '../src/privacy/domain-normalizer.js';
import { matchProtectedHostname } from '../src/privacy/protected-domain-policy.js';

async function setup() {
  const database = await openControlPlaneDatabase(`committed-${crypto.randomUUID()}`);
  const repository = database.createNavigationRepository(() => new Date('2026-08-08T01:00:00Z'));
  const gate = new CaptureGate();
  return { database, repository, gate };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('committed navigation handler', () => {
  it('returns before normalization when the capture gate is closed', async () => {
    const { database, repository, gate } = await setup();
    let normalizations = 0;
    const handle = createCommittedNavigationHandler({
      gate,
      repository,
      normalize: (url) => {
        normalizations++;
        return normalizeNavigationUrl(url);
      },
      matchProtected: matchProtectedHostname
    });

    await handle({ frameId: 0, url: 'https://example.com', transitionType: 'link' });

    expect(normalizations).toBe(0);
    expect(await repository.listUnbatched()).toEqual([]);
    database.close();
  });

  it('ignores subframe commits before normalization', async () => {
    const { database, repository, gate } = await setup();
    const context = gate.open({
      deviceId: '00000000-0000-4000-8000-000000000001',
      sessionId: '00000000-0000-4000-8000-000000000002',
      capturePolicyVersion: 'm4-navigation-v1'
    });
    await repository.openSession(context);
    let normalizations = 0;
    const handle = createCommittedNavigationHandler({
      gate,
      repository,
      normalize: (url) => {
        normalizations++;
        return normalizeNavigationUrl(url);
      },
      matchProtected: matchProtectedHostname
    });

    await handle({ frameId: 1, url: 'https://example.com', transitionType: 'link' });

    expect(normalizations).toBe(0);
    expect(await repository.listUnbatched()).toEqual([]);
    database.close();
  });

  it('normalizes and persists one valid top-level HTTP(S) navigation', async () => {
    const { database, repository, gate } = await setup();
    const context = gate.open({
      deviceId: '00000000-0000-4000-8000-000000000001',
      sessionId: '00000000-0000-4000-8000-000000000002',
      capturePolicyVersion: 'm4-navigation-v1'
    });
    await repository.openSession(context);
    const handle = createCommittedNavigationHandler({
      gate,
      repository,
      normalize: normalizeNavigationUrl,
      matchProtected: matchProtectedHostname,
      now: () => new Date('2026-08-08T01:02:03.004Z')
    });

    await handle({
      frameId: 0,
      url: 'https://www.example.com/private/path?secret=value#fragment',
      transitionType: 'typed',
      documentId: 'transient-document',
      tabId: 42,
      timeStamp: 100
    });

    const [record] = await repository.listUnbatched();
    expect(record).toMatchObject({
      sequence_number: 1,
      event_kind: 'navigation',
      occurred_at: '2026-08-08T01:02:03.004Z',
      page_domain: 'example.com',
      transition_type: 'typed',
      capture_policy_version: 'm4-navigation-v1'
    });
    expect(JSON.stringify(record)).not.toContain('private');
    expect(JSON.stringify(record)).not.toContain('transient-document');
    database.close();
  });

  it.each(['chrome://settings', 'file:///private.txt', 'not a url'])(
    'persists nothing for forbidden or malformed input %s',
    async (url) => {
      const { database, repository, gate } = await setup();
      const context = gate.open({
        deviceId: '00000000-0000-4000-8000-000000000001',
        sessionId: '00000000-0000-4000-8000-000000000002',
        capturePolicyVersion: 'm4-navigation-v1'
      });
      await repository.openSession(context);
      const handle = createCommittedNavigationHandler({
        gate,
        repository,
        normalize: normalizeNavigationUrl,
        matchProtected: matchProtectedHostname
      });

      await handle({ frameId: 0, url, transitionType: 'link' });

      expect(await repository.listUnbatched()).toEqual([]);
      database.close();
    }
  );

  it('drops protected input and increments only the protected-domain counter', async () => {
    const { database, repository, gate } = await setup();
    const context = gate.open({
      deviceId: '00000000-0000-4000-8000-000000000001',
      sessionId: '00000000-0000-4000-8000-000000000002',
      capturePolicyVersion: 'm4-navigation-v1'
    });
    await repository.openSession(context);
    const increments: string[] = [];
    const handle = createCommittedNavigationHandler({
      gate,
      repository,
      normalize: normalizeNavigationUrl,
      matchProtected: matchProtectedHostname,
      incrementIgnored: (reason) => increments.push(reason)
    });

    await handle({ frameId: 0, url: 'https://accounts.google.com/login', transitionType: 'link' });

    expect(await repository.listUnbatched()).toEqual([]);
    expect(increments).toEqual(['ignored_protected_domain']);
    database.close();
  });

  it('uses only the normalizer-provided transient hostname for matching', async () => {
    const { database, repository, gate } = await setup();
    const context = gate.open({
      deviceId: '00000000-0000-4000-8000-000000000001',
      sessionId: '00000000-0000-4000-8000-000000000002',
      capturePolicyVersion: 'm4-navigation-v1'
    });
    await repository.openSession(context);
    const matchedInputs: string[] = [];
    const handle = createCommittedNavigationHandler({
      gate,
      repository,
      normalize: () => ({
        kind: 'accepted',
        pageDomain: 'example.com',
        matchingHostname: 'normalized.example.com'
      }),
      matchProtected: (hostname) => {
        matchedInputs.push(hostname);
        return null;
      },
      isUserExcluded: async (hostname) => {
        matchedInputs.push(hostname);
        return true;
      }
    });

    await handle({ frameId: 0, url: 'https://raw.example.org/path', transitionType: 'link' });

    expect(matchedInputs).toEqual(['normalized.example.com', 'normalized.example.com']);
    expect(await repository.listUnbatched()).toEqual([]);
    database.close();
  });

  it('drops a user-excluded hostname and records only the safe ignore counter', async () => {
    const { database, repository, gate } = await setup();
    const context = gate.open({
      deviceId: '00000000-0000-4000-8000-000000000001',
      sessionId: '00000000-0000-4000-8000-000000000002',
      capturePolicyVersion: 'm4-navigation-v1'
    });
    await repository.openSession(context);
    const increments: string[] = [];
    const handle = createCommittedNavigationHandler({
      gate,
      repository,
      normalize: normalizeNavigationUrl,
      matchProtected: matchProtectedHostname,
      isUserExcluded: async (hostname) => hostname === 'private.example.com',
      incrementIgnored: (reason) => increments.push(reason)
    });

    await handle({
      frameId: 0,
      url: 'https://private.example.com/path?private=value',
      transitionType: 'link'
    });

    expect(await repository.listUnbatched()).toEqual([]);
    expect(increments).toEqual(['ignored_user_domain']);
    database.close();
  });

  it('does not append when the gate generation changes during user exclusion lookup', async () => {
    const { database, repository, gate } = await setup();
    const context = gate.open({
      deviceId: '00000000-0000-4000-8000-000000000001',
      sessionId: '00000000-0000-4000-8000-000000000002',
      capturePolicyVersion: 'm4-navigation-v1'
    });
    await repository.openSession(context);
    const exclusionStarted = deferred<void>();
    const exclusionResult = deferred<boolean>();
    const handle = createCommittedNavigationHandler({
      gate,
      repository,
      normalize: normalizeNavigationUrl,
      matchProtected: matchProtectedHostname,
      isUserExcluded: async () => {
        exclusionStarted.resolve();
        return exclusionResult.promise;
      }
    });

    const handling = handle({ frameId: 0, url: 'https://example.com', transitionType: 'link' });
    await exclusionStarted.promise;
    const closing = gate.close();
    exclusionResult.resolve(false);
    await handling;
    await closing;

    expect(await repository.listUnbatched()).toEqual([]);
    database.close();
  });

  it('suppresses a duplicate transient browser key without persisting that key', async () => {
    const { database, repository, gate } = await setup();
    const context = gate.open({
      deviceId: '00000000-0000-4000-8000-000000000001',
      sessionId: '00000000-0000-4000-8000-000000000002',
      capturePolicyVersion: 'm4-navigation-v1'
    });
    await repository.openSession(context);
    const ignored: string[] = [];
    const handle = createCommittedNavigationHandler({
      gate,
      repository,
      normalize: normalizeNavigationUrl,
      matchProtected: matchProtectedHostname,
      duplicateCache: new NavigationDuplicateCache({ capacity: 4, ttlMs: 1_000 }),
      nowMs: () => 100,
      incrementIgnored: (reason) => ignored.push(reason)
    });
    const details = {
      frameId: 0,
      url: 'https://example.com',
      transitionType: 'link',
      documentId: 'browser-document-id',
      tabId: 42,
      timeStamp: 900
    };

    await handle(details);
    await handle(details);

    const rows = await repository.listUnbatched();
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain('browser-document-id');
    expect(ignored).toEqual([]);
    database.close();
  });

  it('closes capture into durable sync error when repository capacity is exceeded', async () => {
    const database = await openControlPlaneDatabase(`committed-capacity-${crypto.randomUUID()}`);
    const repository = database.createNavigationRepository(undefined, {
      maxPendingEvents: 1,
      maxPendingEventBytes: 1_048_576
    });
    const gate = new CaptureGate();
    const context = gate.open({
      deviceId: '00000000-0000-4000-8000-000000000001',
      sessionId: '00000000-0000-4000-8000-000000000002',
      capturePolicyVersion: 'm4-navigation-v1'
    });
    await repository.openSession(context);
    await repository.appendDraft(
      {
        client_event_id: '00000000-0000-4000-8000-000000000031',
        event_kind: 'navigation',
        occurred_at: '2026-08-08T01:00:00.000Z',
        page_domain: 'example.com',
        transition_type: 'link',
        capture_policy_version: 'm4-navigation-v1'
      },
      context
    );
    let syncErrors = 0;
    const handle = createCommittedNavigationHandler({
      gate,
      repository,
      normalize: normalizeNavigationUrl,
      matchProtected: matchProtectedHostname,
      onSyncError: () => syncErrors++
    });

    await handle({ frameId: 0, url: 'https://example.org', transitionType: 'link' });

    expect(gate.acquire()).toBeNull();
    expect(await repository.listUnbatched()).toHaveLength(1);
    expect(await repository.getCoordinationState()).toMatchObject({
      gate_open: false,
      event_count: 1,
      sync_status: 'sync_error'
    });
    expect(syncErrors).toBe(1);
    database.close();
  });
});
