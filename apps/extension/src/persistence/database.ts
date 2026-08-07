export const CONTROL_PLANE_STORES = [
  'extension_config',
  'device_metadata',
  'monitoring_sessions',
  'pending_mutations',
  'idempotency_records',
  'domain_rules',
  'sync_metadata'
] as const;

export type ControlPlaneStore = (typeof CONTROL_PLANE_STORES)[number];
const DATABASE_VERSION = 2;

const forbiddenField =
  /^(access_?token|refresh_?token|password|authorization|cookie|url|dom|screenshot|clipboard|form(_value)?|browser_?event)$/i;

function assertNonSecret(value: unknown): void {
  if (Array.isArray(value)) return value.forEach(assertNonSecret);
  if (!value || typeof value !== 'object') return;
  for (const [key, nested] of Object.entries(value)) {
    if (forbiddenField.test(key))
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

  async put(store: ControlPlaneStore, value: Record<string, unknown>): Promise<void> {
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
          database.createObjectStore(store, {
            keyPath: store === 'pending_mutations' ? 'local_operation_id' : 'id'
          });
        }
      });
    };
    request.onsuccess = () => resolve(new ControlPlaneDatabase(request.result));
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
  });
}
