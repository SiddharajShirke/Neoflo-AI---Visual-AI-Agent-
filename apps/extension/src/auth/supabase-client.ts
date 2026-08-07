import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createSessionStorageAdapter, type SessionStorageArea } from './session-storage.js';

export interface SanitizedAuthState {
  authenticated: boolean;
  email: string | null;
}

/** Worker-only Supabase Auth owner. The popup receives only SanitizedAuthState. */
export class WorkerAuth {
  private readonly client: SupabaseClient;

  constructor(url: string, publishableKey: string, client?: SupabaseClient) {
    const sessionStorage = (
      globalThis as unknown as { chrome: { storage: { session: SessionStorageArea } } }
    ).chrome.storage.session;
    this.client =
      client ??
      createClient(url, publishableKey, {
        auth: {
          storage: createSessionStorageAdapter(sessionStorage),
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false
        }
      });
  }

  async state(): Promise<SanitizedAuthState> {
    const { data } = await this.client.auth.getSession();
    return { authenticated: Boolean(data.session?.user), email: data.session?.user.email ?? null };
  }

  async signInWithPassword(email: string, password: string): Promise<SanitizedAuthState> {
    const { error } = await this.client.auth.signInWithPassword({ email, password });
    if (error) throw new Error('sign_in_failed');
    return this.state();
  }

  async accessToken(): Promise<string | null> {
    const { data } = await this.client.auth.getSession();
    return data.session?.access_token ?? null;
  }

  async refreshAccessToken(): Promise<boolean> {
    const { data, error } = await this.client.auth.refreshSession();
    return !error && Boolean(data.session?.access_token);
  }

  async signOut(): Promise<void> {
    await this.client.auth.signOut({ scope: 'local' });
  }
}
