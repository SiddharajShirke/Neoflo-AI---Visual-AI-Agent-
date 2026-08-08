import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import {
  CONTROL_PLANE_STORES,
  NAVIGATION_STORES,
  openControlPlaneDatabase
} from '../src/persistence/database.js';

describe('control-plane IndexedDB', () => {
  it('creates every versioned non-secret store', async () => {
    const database = await openControlPlaneDatabase(`m3-${crypto.randomUUID()}`);
    expect([...database.objectStoreNames].sort()).toEqual(
      [...CONTROL_PLANE_STORES, ...NAVIGATION_STORES].sort()
    );
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

  it.each(['page_url', 'pageURL', 'authorizationHeader'])(
    'rejects nested normalized sensitive key variant %s',
    async (field) => {
      const database = await openControlPlaneDatabase(`m3-nested-${field}-${crypto.randomUUID()}`);
      await expect(
        database.put('extension_config', { id: 'unsafe', metadata: { [field]: 'synthetic' } })
      ).rejects.toThrow('secret or browser-content field');
      database.close();
    }
  );

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
    expect([...database.objectStoreNames].sort()).toEqual(
      [...CONTROL_PLANE_STORES, ...NAVIGATION_STORES].sort()
    );
    database.close();
  });

  it('upgrades version two without changing existing stores or records', async () => {
    const name = `m4-upgrade-${crypto.randomUUID()}`;
    const existingRows = new Map(
      CONTROL_PLANE_STORES.map((store) => [
        store,
        store === 'pending_mutations'
          ? { local_operation_id: `existing-${store}`, value: store }
          : { id: `existing-${store}`, value: store }
      ])
    );

    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(name, 2);
      request.onupgradeneeded = () => {
        for (const store of CONTROL_PLANE_STORES) {
          const objectStore = request.result.createObjectStore(store, {
            keyPath: store === 'pending_mutations' ? 'local_operation_id' : 'id'
          });
          objectStore.put(existingRows.get(store)!);
        }
      };
      request.onsuccess = () => {
        request.result.close();
        resolve();
      };
      request.onerror = () => reject(request.error);
    });

    const database = await openControlPlaneDatabase(name);
    expect([...database.objectStoreNames].sort()).toEqual(
      [...CONTROL_PLANE_STORES, ...NAVIGATION_STORES].sort()
    );
    for (const store of CONTROL_PLANE_STORES) {
      await expect(database.get(store, `existing-${store}`)).resolves.toEqual(
        existingRows.get(store)
      );
    }
    database.close();

    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(name, 3);
      request.onsuccess = () => {
        const upgraded = request.result;
        expect(
          upgraded.transaction('navigation_event_buffer').objectStore('navigation_event_buffer')
            .keyPath
        ).toBe('client_event_id');
        expect(
          upgraded.transaction('navigation_batches').objectStore('navigation_batches').keyPath
        ).toBe('batch_id');
        upgraded.close();
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  });
});
