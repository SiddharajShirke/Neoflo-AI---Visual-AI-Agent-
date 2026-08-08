export type PopupMonitoring = { kind: string; consentActive?: boolean };
export type SafeNavigationSyncView = {
  pendingCount: number;
  syncState: 'healthy' | 'offline_buffering' | 'sync_error';
};
export const protectedDomainPolicyStatement =
  'The built-in protected-domain policy is a conservative, non-exhaustive protection layer. User exclusions provide additional protection.';
export type PopupCommand =
  | 'grant_consent'
  | 'withdraw_consent'
  | 'start'
  | 'pause'
  | 'resume'
  | 'stop'
  | 'retry_sync'
  | 'sign_out';

export function popupControls(
  monitoring: PopupMonitoring | undefined
): Record<PopupCommand, boolean> {
  const kind = monitoring?.kind;
  return {
    grant_consent: kind === 'READY' && !monitoring?.consentActive,
    withdraw_consent: kind === 'READY' && Boolean(monitoring?.consentActive),
    start: kind === 'READY' && Boolean(monitoring?.consentActive),
    pause: kind === 'RECORDING',
    resume: kind === 'PAUSED',
    stop: kind === 'RECORDING' || kind === 'PAUSED',
    retry_sync: kind === 'OFFLINE_BUFFERING' || kind === 'SYNC_ERROR',
    sign_out: kind !== 'SIGNED_OUT' && kind !== undefined
  };
}

export function safeNavigationSyncView(value: SafeNavigationSyncView): SafeNavigationSyncView {
  if (
    !value ||
    typeof value !== 'object' ||
    Object.keys(value).length !== 2 ||
    !Object.keys(value).every((key) => key === 'pendingCount' || key === 'syncState') ||
    !Number.isInteger(value.pendingCount) ||
    value.pendingCount < 0 ||
    !['healthy', 'offline_buffering', 'sync_error'].includes(value.syncState)
  ) {
    throw new Error('invalid navigation sync view');
  }
  return { pendingCount: value.pendingCount, syncState: value.syncState };
}
