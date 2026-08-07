import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { CONTROL_PLANE_STORES, openControlPlaneDatabase } from '../src/persistence/database.js';

describe('control-plane IndexedDB', () => {
  it('creates every versioned non-secret store', async () => {
    const database = await openControlPlaneDatabase(`m3-${crypto.randomUUID()}`);
    expect([...database.objectStoreNames].sort()).toEqual([...CONTROL_PLANE_STORES].sort());
    database.close();
  });

  it('rejects token, authorization, and browser-content fields before persistence', async () => {
    const database = await openControlPlaneDatabase(`m3-${crypto.randomUUID()}`);
    await expect(
      database.put('pending_mutations', {
        local_operation_id: 'unsafe',
        authorization: 'Bearer token'
      })
    ).rejects.toThrow('secret or browser-content field');
    database.close();
  });

  it.each([
    'access_token',
    'refresh_token',
    'password',
    'Authorization',
    'url',
    'browser_event',
    'dom',
    'screenshot',
    'clipboard',
    'form_value'
  ])('rejects %s at every persistent-store boundary', async (field) => {
    const database = await openControlPlaneDatabase(`m3-forbidden-${field}-${crypto.randomUUID()}`);
    await expect(
      database.put('extension_config', { id: 'unsafe', [field]: 'synthetic' })
    ).rejects.toThrow('secret or browser-content field');
    database.close();
  });

  it('upgrades the unreleased version-one queue without preserving its obsolete key', async () => {
    const name = `m3-upgrade-${crypto.randomUUID()}`;
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore('pending_mutations', { keyPath: 'id' });
      request.onsuccess = () => {
        request.result.close();
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
    const database = await openControlPlaneDatabase(name);
    expect([...database.objectStoreNames].sort()).toEqual([...CONTROL_PLANE_STORES].sort());
    database.close();
  });
});
