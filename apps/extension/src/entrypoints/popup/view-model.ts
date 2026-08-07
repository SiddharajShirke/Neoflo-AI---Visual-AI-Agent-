export type PopupMonitoring = { kind: string; consentActive?: boolean };
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
