export interface SessionStorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(values: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

/** Supabase-compatible async storage backed exclusively by chrome.storage.session. */
export function createSessionStorageAdapter(area: SessionStorageArea) {
  return {
    async getItem(key: string): Promise<string | null> {
      const value = (await area.get(key))[key];
      return typeof value === 'string' ? value : null;
    },
    async setItem(key: string, value: string): Promise<void> {
      await area.set({ [key]: value });
    },
    async removeItem(key: string): Promise<void> {
      await area.remove(key);
    }
  };
}
