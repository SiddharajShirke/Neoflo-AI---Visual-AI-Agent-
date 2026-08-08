import { defineBackground } from 'wxt/sandbox';
import { ApiClient } from '../api/client.js';
import { WorkerAuth } from '../auth/supabase-client.js';
import { indicatorFor } from '../core/indicator.js';
import { ControlPlaneOrchestrator } from '../core/orchestrator.js';
import { dispatchRuntimeMessage, type RuntimeMessage } from '../core/runtime-message.js';
import { openControlPlaneDatabase, type ControlPlaneDatabase } from '../persistence/database.js';
import {
  DomainRuleRepository,
  matchesDomainRule,
  protectedCategories
} from '../persistence/domain-rules.js';
import { QueueAlarmScheduler } from '../queue/alarm-scheduler.js';
import { MutationDeliveryEngine } from '../queue/delivery.js';
import { NavigationAlarmScheduler } from '../navigation/alarm-scheduler.js';
import { formNextBatch } from '../navigation/batch-builder.js';
import { CaptureGate } from '../navigation/capture-gate.js';
import { NavigationDeliveryEngine } from '../navigation/delivery.js';
import { createCommittedNavigationHandler } from '../navigation/committed-navigation-handler.js';
import { installCommittedNavigationListener } from '../navigation/committed-navigation-listener.js';
import { NavigationDuplicateCache } from '../navigation/duplicate-cache.js';
import { NavigationMetrics } from '../navigation/metrics.js';
import { NavigationLifecycleCoordinator } from '../navigation/lifecycle-coordinator.js';
import { NavigationRepository } from '../navigation/navigation-repository.js';
import {
  NavigationSessionInvalidator,
  NavigationSessionNotRecordingReconciler
} from '../navigation/shutdown.js';
import type { PendingMutation } from '../queue/mutations.js';
import { normalizeNavigationUrl } from '../privacy/domain-normalizer.js';
import { matchProtectedHostname } from '../privacy/protected-domain-policy.js';

type Runtime = {
  runtime: {
    onMessage: { addListener(listener: (message: RuntimeMessage) => Promise<unknown>): void };
    onStartup: { addListener(listener: () => void): void };
  };
  alarms: {
    create(name: string, info: { when: number }): void;
    onAlarm: { addListener(listener: (alarm: { name: string }) => void): void };
  };
  webNavigation: {
    onCommitted: { addListener(listener: (details: unknown) => void): void };
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
  const navigation = {
    gate: new CaptureGate(),
    repository: null as NavigationRepository | null,
    delivery: null as NavigationDeliveryEngine | null,
    lifecycle: null as NavigationLifecycleCoordinator | null,
    scheduler: null as NavigationAlarmScheduler | null,
    listenerInstalled: false,
    duplicateCache: new NavigationDuplicateCache(),
    metrics: new NavigationMetrics()
  };
  const currentNavigationScheduler = (): NavigationAlarmScheduler | null => navigation.scheduler;

  const configured = () => Boolean(apiUrl && supabaseUrl && publishableKey);
  const db = () => (database ??= openControlPlaneDatabase());
  const ensure = async (): Promise<{
    auth: WorkerAuth;
    orchestrator: ControlPlaneOrchestrator;
    database: ControlPlaneDatabase;
    invalidateNavigation(reason: 'authentication_required' | 'consent_inactive'): Promise<void>;
  }> => {
    if (!configured()) throw new Error('configuration_required');
    auth ??= new WorkerAuth(supabaseUrl!, publishableKey!);
    const databaseInstance = await db();
    const api = new ApiClient(
      apiUrl!,
      () => auth!.accessToken(),
      () => auth!.refreshAccessToken()
    );
    navigation.repository ??= databaseInstance.createNavigationRepository();
    if (!navigation.listenerInstalled) {
      const handler = createCommittedNavigationHandler({
        gate: navigation.gate,
        repository: navigation.repository,
        normalize: normalizeNavigationUrl,
        matchProtected: matchProtectedHostname,
        isUserExcluded: async (hostname) => {
          const rules = await new DomainRuleRepository(databaseInstance).list();
          return rules.some((rule) => matchesDomainRule(hostname, rule));
        },
        duplicateCache: navigation.duplicateCache,
        metrics: navigation.metrics,
        onSyncError: () => void setIndicator('SYNC_ERROR')
      });
      installCommittedNavigationListener(
        browser.chrome.webNavigation as never,
        handler,
        async () => {
          await navigation.gate.close();
          await setIndicator('SYNC_ERROR');
        }
      );
      navigation.listenerInstalled = true;
    }
    const deliverNavigationAndSchedule = async (): Promise<void> => {
      await navigation.delivery?.deliverDue();
      const coordination = await navigation.repository?.getCoordinationState();
      if (coordination) {
        navigation.metrics.setQueueHealth({
          pendingCount: coordination.event_count,
          pendingBytes: coordination.event_bytes,
          oldestPendingAgeMs:
            coordination.oldest_pending_at === null
              ? 0
              : Math.max(0, Date.now() - Date.parse(coordination.oldest_pending_at))
        });
      }
      await navigation.scheduler?.schedule(new Date(Date.now() + 30_000));
    };
    const invalidateNavigation = async (
      sessionId: string,
      reason:
        | 'authentication_required'
        | 'device_revoked'
        | 'consent_inactive'
        | 'capture_policy_mismatch'
    ): Promise<void> => {
      const invalidator = new NavigationSessionInvalidator(
        navigation.gate,
        navigation.repository!,
        {
          onAuthenticationRequired: async () => {
            await auth!.signOut();
            await orchestrator!.initialize(false);
          },
          onSafeState: async () => {
            await setIndicator(reason === 'authentication_required' ? 'SIGNED_OUT' : 'SYNC_ERROR');
          }
        }
      );
      await invalidator.invalidate(sessionId, reason);
    };
    const invalidateCurrentNavigation = async (
      reason: 'authentication_required' | 'consent_inactive'
    ): Promise<void> => {
      const sessionId =
        orchestrator?.snapshot().sessionId ??
        (await navigation.repository!.getCoordinationState())?.buffer_session_id;
      if (sessionId) {
        await invalidateNavigation(sessionId, reason);
        return;
      }
      await navigation.gate.closeAndDrain();
    };
    navigation.delivery ??= new NavigationDeliveryEngine(navigation.repository, api, {
      metrics: navigation.metrics,
      onAuthRequired: async () => {
        const sessionId = orchestrator?.snapshot().sessionId;
        if (sessionId) await invalidateNavigation(sessionId, 'authentication_required');
      },
      onSessionNotRecording: async (sessionId) => {
        const reconciler = new NavigationSessionNotRecordingReconciler(
          navigation.gate,
          navigation.repository!,
          api,
          {
            projectRemoteState: async (status) => {
              await orchestrator!.applyReconciledSessionStatus(sessionId, status);
              await setIndicator(orchestrator!.snapshot().kind);
            },
            safeSyncError: async () => setIndicator('SYNC_ERROR'),
            onCapturePolicyMismatch: async (invalidSessionId) =>
              invalidateNavigation(invalidSessionId, 'capture_policy_mismatch')
          }
        );
        try {
          return await reconciler.reconcile(sessionId);
        } catch {
          await navigation.gate.close();
          await setIndicator('SYNC_ERROR');
          return 'hold';
        }
      },
      onRetryScheduled: async () => {
        await navigation.scheduler?.schedule(new Date(Date.now() + 30_000));
      },
      onAuthorityOutcome: async (outcome, sessionId) => {
        await invalidateNavigation(sessionId, outcome);
      },
      onSyncError: () => void setIndicator('SYNC_ERROR')
    });
    navigation.scheduler ??= new NavigationAlarmScheduler(
      browser.chrome.alarms,
      deliverNavigationAndSchedule
    );
    navigation.lifecycle ??= new NavigationLifecycleCoordinator(
      navigation.gate,
      {
        closeForLifecycle: (sessionId, intent) =>
          navigation.repository!.closeForLifecycle(sessionId, intent),
        formAllBatches: async (_sessionId, context) => {
          while (true) {
            const batch = await formNextBatch(navigation.repository!, context, navigation.metrics);
            if (batch === null) break;
          }
        },
        hasPendingForSession: (sessionId) => navigation.repository!.hasPendingForSession(sessionId),
        clearLifecycleIntent: (sessionId, intent) =>
          navigation.repository!.clearLifecycleIntent(sessionId, intent)
      },
      navigation.delivery
    );
    orchestrator ??= new ControlPlaneOrchestrator(
      api,
      databaseInstance,
      {
        gate: navigation.gate,
        repository: navigation.repository,
        schedulePendingDelivery: deliverNavigationAndSchedule
      },
      navigation.lifecycle
    );
    delivery ??= new MutationDeliveryEngine(databaseInstance, api, {
      onAuthRequired: () => {
        const sessionId = orchestrator?.snapshot().sessionId;
        if (sessionId) {
          void invalidateNavigation(sessionId, 'authentication_required');
          return;
        }
        void navigation.gate.close();
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
    return {
      auth,
      orchestrator,
      database: databaseInstance,
      invalidateNavigation: invalidateCurrentNavigation
    };
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
    if (authState.authenticated) {
      await deliverAndSchedule();
      await currentNavigationScheduler()?.schedule(new Date(Date.now() + 30_000));
    }
  };

  browser.chrome.alarms.onAlarm.addListener((alarm) => {
    void scheduler?.onAlarm(alarm.name);
    void currentNavigationScheduler()?.onAlarm(alarm.name);
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
      invalidateNavigation: services.invalidateNavigation,
      deliverAndSchedule,
      setIndicator,
      getNavigationSyncView: async () => {
        const coordination = await navigation.repository?.getCoordinationState();
        return {
          pendingCount: coordination?.event_count ?? 0,
          syncState: coordination?.sync_status ?? 'healthy'
        };
      },
      listDomains: () => domains.list(),
      addDomain: (domain) => domains.add(domain),
      removeDomain: (domain) => domains.remove(domain),
      protectedCategories
    });
  });
});
