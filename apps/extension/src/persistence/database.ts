import { NavigationRepository } from '../navigation/navigation-repository.js';

export const CONTROL_PLANE_STORES = [
  'extension_config',
  'device_metadata',
  'monitoring_sessions',
  'pending_mutations',
  'idempotency_records',
  'domain_rules',
  'sync_metadata'
] as const;

export const NAVIGATION_STORES = ['navigation_event_buffer', 'navigation_batches'] as const;

const STORE_KEY_PATHS = {
  extension_config: 'id',
  device_metadata: 'id',
  monitoring_sessions: 'id',
  pending_mutations: 'local_operation_id',
  idempotency_records: 'id',
  domain_rules: 'id',
  sync_metadata: 'id',
  navigation_event_buffer: 'client_event_id',
  navigation_batches: 'batch_id'
} as const;

export type ControlPlaneStore = (typeof CONTROL_PLANE_STORES)[number];
export type NavigationStore = (typeof NAVIGATION_STORES)[number];
export const DATABASE_VERSION = 3;

const forbiddenField =
  /^(accesstoken|refreshtoken|password|authorization(?:header)?|cookies?|url|pageurl|dom|screenshot|clipboard|form(?:value|values)?|browserevent)$/i;

function assertNonSecret(value: unknown): void {
  if (Array.isArray(value)) return value.forEach(assertNonSecret);
  if (!value || typeof value !== 'object') return;
  for (const [key, nested] of Object.entries(value)) {
    if (forbiddenField.test(key.replaceAll(/[_-]/g, '').toLowerCase()))
      throw new Error('secret or browser-content field cannot be persisted');
    assertNonSecret(nested);
  }
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

export class ControlPlaneDatabase {
  constructor(private readonly database: IDBDatabase) {}

  get objectStoreNames(): DOMStringList {
    return this.database.objectStoreNames;
  }

  close(): void {
    this.database.close();
  }

  /**
   * The only production entry point for navigation persistence. The raw
   * IndexedDB handle intentionally never crosses this boundary.
   */
  createNavigationRepository(
    now: () => Date = () => new Date(),
    limits?: { maxPendingEvents?: number; maxPendingEventBytes?: number }
  ): NavigationRepository {
    return new NavigationRepository(this.database, now, limits);
  }

  async put(store: ControlPlaneStore, value: Record<string, unknown>): Promise<void> {
    if (!(CONTROL_PLANE_STORES as readonly string[]).includes(store)) {
      throw new Error('navigation stores require the strict navigation repository');
    }
    if (
      store === 'sync_metadata' &&
      typeof value.id === 'string' &&
      value.id.startsWith('navigation_')
    ) {
      throw new Error('navigation coordination requires the strict navigation repository');
    }
    assertNonSecret(value);
    const transaction = this.database.transaction(store, 'readwrite');
    await requestResult(transaction.objectStore(store).put(value));
  }

  async get<T extends Record<string, unknown>>(
    store: ControlPlaneStore,
    id: string
  ): Promise<T | undefined> {
    const transaction = this.database.transaction(store, 'readonly');
    return (await requestResult(transaction.objectStore(store).get(id))) as T | undefined;
  }

  async getAll<T extends Record<string, unknown>>(store: ControlPlaneStore): Promise<T[]> {
    const transaction = this.database.transaction(store, 'readonly');
    return (await requestResult(transaction.objectStore(store).getAll())) as T[];
  }

  async delete(store: ControlPlaneStore, id: string): Promise<void> {
    const transaction = this.database.transaction(store, 'readwrite');
    await requestResult(transaction.objectStore(store).delete(id));
  }
}

export function openControlPlaneDatabase(
  name = 'visual-ai-control-plane'
): Promise<ControlPlaneDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, DATABASE_VERSION);
    request.onupgradeneeded = (event) => {
      const database = request.result;
      // Version 1 was an unreleased foundation. Re-key its empty queue by the
      // durable local operation id before queue delivery is introduced.
      if (
        request.transaction &&
        event.oldVersion < 2 &&
        database.objectStoreNames.contains('pending_mutations')
      ) {
        database.deleteObjectStore('pending_mutations');
      }
      CONTROL_PLANE_STORES.forEach((store) => {
        if (!database.objectStoreNames.contains(store)) {
          database.createObjectStore(store, { keyPath: STORE_KEY_PATHS[store] });
        }
      });
      NAVIGATION_STORES.forEach((store) => {
        if (!database.objectStoreNames.contains(store)) {
          database.createObjectStore(store, { keyPath: STORE_KEY_PATHS[store] });
        }
      });
    };
    request.onsuccess = () => resolve(new ControlPlaneDatabase(request.result));
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
  });
}
