export type RuntimeMessage = { type: string; email?: string; password?: string; domain?: string };

type AuthState = { authenticated: boolean; email: string | null };
type MonitoringState = { kind: string; sessionId: string | null; consentActive: boolean };

export interface RuntimeMessageDependencies {
  auth: {
    state(): Promise<AuthState>;
    signInWithPassword(email: string, password: string): Promise<unknown>;
    signOut(): Promise<void>;
  };
  orchestrator: {
    initialize(authenticated: boolean): Promise<MonitoringState>;
    snapshot(): MonitoringState;
    registerDevice(): Promise<unknown>;
    setMonitoringConsent(granted: boolean): Promise<unknown>;
    start(): Promise<unknown>;
    pause(): Promise<unknown>;
    resume(): Promise<unknown>;
    stop(): Promise<unknown>;
  };
  blockQueuedMutations(): Promise<void>;
  deliverAndSchedule(): Promise<void>;
  setIndicator(kind: string): Promise<void>;
  listDomains(): Promise<string[]>;
  addDomain(domain: string): Promise<unknown>;
  removeDomain(domain: string): Promise<unknown>;
  protectedCategories: readonly string[];
}

function sanitizedAuthState(value: AuthState): AuthState {
  return {
    authenticated: value.authenticated === true,
    email: typeof value.email === 'string' ? value.email : null
  };
}

export async function dispatchRuntimeMessage(
  message: RuntimeMessage,
  dependencies: RuntimeMessageDependencies
): Promise<Record<string, unknown>> {
  if (message.type === 'sign_in') {
    if (!message.email || !message.password) return { error: 'sign_in_failed' };
    try {
      await dependencies.auth.signInWithPassword(message.email, message.password);
    } catch {
      return { error: 'sign_in_failed' };
    }
  }
  if (message.type === 'sign_out') {
    await dependencies.auth.signOut();
    await dependencies.blockQueuedMutations();
    const monitoring = await dependencies.orchestrator.initialize(false);
    await dependencies.setIndicator(monitoring.kind);
    return { auth: { authenticated: false, email: null }, monitoring };
  }

  const auth = sanitizedAuthState(await dependencies.auth.state());
  await dependencies.orchestrator.initialize(auth.authenticated);
  if (auth.authenticated) await dependencies.orchestrator.registerDevice();
  if (message.type === 'grant_consent') await dependencies.orchestrator.setMonitoringConsent(true);
  if (message.type === 'withdraw_consent')
    await dependencies.orchestrator.setMonitoringConsent(false);
  if (message.type === 'start') await dependencies.orchestrator.start();
  if (message.type === 'pause') await dependencies.orchestrator.pause();
  if (message.type === 'resume') await dependencies.orchestrator.resume();
  if (message.type === 'stop') await dependencies.orchestrator.stop();
  if (message.type === 'retry_sync' && auth.authenticated) await dependencies.deliverAndSchedule();
  if (auth.authenticated) await dependencies.deliverAndSchedule();
  if (message.type === 'add_domain' && message.domain) await dependencies.addDomain(message.domain);
  if (message.type === 'remove_domain' && message.domain)
    await dependencies.removeDomain(message.domain);

  const monitoring = dependencies.orchestrator.snapshot();
  await dependencies.setIndicator(monitoring.kind);
  return {
    auth,
    monitoring,
    domains: await dependencies.listDomains(),
    protectedCategories: dependencies.protectedCategories
  };
}
