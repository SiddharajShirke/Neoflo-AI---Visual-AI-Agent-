import { defineBackground } from 'wxt/sandbox';
import { ApiClient } from '../api/client.js';
import { WorkerAuth } from '../auth/supabase-client.js';
import { indicatorFor } from '../core/indicator.js';
import { ControlPlaneOrchestrator } from '../core/orchestrator.js';
import { dispatchRuntimeMessage, type RuntimeMessage } from '../core/runtime-message.js';
import { openControlPlaneDatabase, type ControlPlaneDatabase } from '../persistence/database.js';
import { DomainRuleRepository, protectedCategories } from '../persistence/domain-rules.js';
import { QueueAlarmScheduler } from '../queue/alarm-scheduler.js';
import { MutationDeliveryEngine } from '../queue/delivery.js';
import type { PendingMutation } from '../queue/mutations.js';

type Runtime = {
  runtime: {
    onMessage: { addListener(listener: (message: RuntimeMessage) => Promise<unknown>): void };
    onStartup: { addListener(listener: () => void): void };
  };
  alarms: {
    create(name: string, info: { when: number }): void;
    onAlarm: { addListener(listener: (alarm: { name: string }) => void): void };
  };
  storage: {
    session: { setAccessLevel?(options: { accessLevel: 'TRUSTED_CONTEXTS' }): Promise<void> };
  };
  action: {
    setBadgeText(details: { text: string }): Promise<void>;
    setTitle(details: { title: string }): Promise<void>;
  };
};
const browser = globalThis as unknown as { chrome: Runtime };

async function setIndicator(kind: string): Promise<void> {
  const indicator: Record<string, [string, string]> = {
    READY: ['', 'Ready — monitoring off'],
    RECORDING: ['ON', 'Monitoring session active'],
    PAUSED: ['II', 'Monitoring session paused'],
    OFFLINE_BUFFERING: ['…', 'Changes awaiting synchronization'],
    SYNC_ERROR: ['!', 'Monitoring synchronization needs attention']
  };
  let [text, title] = indicator[kind] ?? [
    '',
    kind === 'SIGNED_OUT' ? 'Sign in required' : 'Monitoring unavailable'
  ];
  ({ text, title } = indicatorFor(kind));
  await browser.chrome.action.setBadgeText({ text });
  await browser.chrome.action.setTitle({ title });
}

export default defineBackground(() => {
  const apiUrl = import.meta.env.VITE_API_BASE_URL;
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  let database: Promise<ControlPlaneDatabase> | null = null;
  let orchestrator: ControlPlaneOrchestrator | null = null;
  let auth: WorkerAuth | null = null;
  let delivery: MutationDeliveryEngine | null = null;
  let scheduler: QueueAlarmScheduler | null = null;

  const configured = () => Boolean(apiUrl && supabaseUrl && publishableKey);
  const db = () => (database ??= openControlPlaneDatabase());
  const ensure = async (): Promise<{
    auth: WorkerAuth;
    orchestrator: ControlPlaneOrchestrator;
    database: ControlPlaneDatabase;
  }> => {
    if (!configured()) throw new Error('configuration_required');
    auth ??= new WorkerAuth(supabaseUrl!, publishableKey!);
    const databaseInstance = await db();
    const api = new ApiClient(
      apiUrl!,
      () => auth!.accessToken(),
      () => auth!.refreshAccessToken()
    );
    orchestrator ??= new ControlPlaneOrchestrator(api, databaseInstance);
    delivery ??= new MutationDeliveryEngine(databaseInstance, api, {
      onAuthRequired: () => {
        void auth!.signOut();
        void orchestrator!.initialize(false);
      },
      onDelivered: async (mutation, response) => {
        await orchestrator!.applyDeliveredMutation(mutation, response);
        await setIndicator(orchestrator!.snapshot().kind);
      },
      onReconciled: (_sessionId, status) => {
        void setIndicator(
          status === 'recording' ? 'RECORDING' : status === 'paused' ? 'PAUSED' : 'STOPPED'
        );
      },
      onSyncError: () => {
        void setIndicator('SYNC_ERROR');
      }
    });
    scheduler ??= new QueueAlarmScheduler(browser.chrome.alarms, async () => deliverAndSchedule());
    return { auth, orchestrator, database: databaseInstance };
  };
  const deliverAndSchedule = async (): Promise<void> => {
    if (!delivery || !database) return;
    await delivery.deliverDue();
    const pending = await (await database).getAll<PendingMutation>('pending_mutations');
    const next = pending
      .filter((mutation) => mutation.state === 'pending')
      .map((mutation) => Date.parse(mutation.next_retry_at))
      .sort((a, b) => a - b)[0];
    if (next !== undefined) await scheduler?.schedule(new Date(next));
  };
  const blockQueuedMutations = async (): Promise<void> => {
    const databaseInstance = await db();
    const mutations = await databaseInstance.getAll<PendingMutation>('pending_mutations');
    await Promise.all(
      mutations
        .filter((mutation) => mutation.state === 'pending' || mutation.state === 'delivering')
        .map((mutation) =>
          databaseInstance.put('pending_mutations', { ...mutation, state: 'blocked_auth' })
        )
    );
  };
  const restore = async (): Promise<void> => {
    if (!configured()) return;
    await browser.chrome.storage.session.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' });
    const services = await ensure();
    const authState = await services.auth.state();
    const snapshot = await services.orchestrator.initialize(authState.authenticated);
    await setIndicator(snapshot.kind);
    if (authState.authenticated) await deliverAndSchedule();
  };

  browser.chrome.alarms.onAlarm.addListener((alarm) => {
    void scheduler?.onAlarm(alarm.name);
  });
  browser.chrome.runtime.onStartup.addListener(() => {
    void restore();
  });
  void restore();

  browser.chrome.runtime.onMessage.addListener(async (message) => {
    if (!configured()) return { error: 'configuration_required' };
    const services = await ensure();
    const domains = new DomainRuleRepository(services.database);
    return dispatchRuntimeMessage(message, {
      auth: services.auth,
      orchestrator: services.orchestrator,
      blockQueuedMutations,
      deliverAndSchedule,
      setIndicator,
      listDomains: () => domains.list(),
      addDomain: (domain) => domains.add(domain),
      removeDomain: (domain) => domains.remove(domain),
      protectedCategories
    });
  });
});
