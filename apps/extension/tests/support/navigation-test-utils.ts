/** Test-only IndexedDB corruption utility. Never imported by extension source. */
export async function overwriteNavigationBatchForTest(
  databaseName: string,
  value: Record<string, unknown>
): Promise<void> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('test database open failed'));
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('navigation_batches', 'readwrite');
      transaction.objectStore('navigation_batches').put(value);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('test transaction failed'));
    });
  } finally {
    database.close();
  }
}
