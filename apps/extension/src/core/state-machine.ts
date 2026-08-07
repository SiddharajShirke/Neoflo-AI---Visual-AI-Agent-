export type MonitoringStateKind =
  | 'UNCONFIGURED'
  | 'SIGNED_OUT'
  | 'READY'
  | 'STARTING'
  | 'RECORDING'
  | 'PAUSING'
  | 'PAUSED'
  | 'RESUMING'
  | 'STOPPING'
  | 'STOPPED'
  | 'OFFLINE_BUFFERING'
  | 'SYNC_ERROR';

export type RemoteSessionStatus = 'recording' | 'paused' | 'completed' | 'cancelled';

export interface MonitoringState {
  kind: MonitoringStateKind;
  sessionId: string | null;
  consentActive: boolean;
  errorCode: string | null;
}

export type MonitoringEvent =
  | { type: 'SIGNED_OUT' }
  | { type: 'READY'; consentActive: boolean }
  | { type: 'START_REQUESTED' }
  | { type: 'PAUSE_REQUESTED' }
  | { type: 'RESUME_REQUESTED' }
  | { type: 'STOP_REQUESTED' }
  | { type: 'REMOTE_CONFIRMED'; status: RemoteSessionStatus; sessionId: string }
  | { type: 'OFFLINE_BUFFERING' }
  | { type: 'SYNC_ERROR'; code: string };

export const initialMonitoringState: MonitoringState = {
  kind: 'UNCONFIGURED',
  sessionId: null,
  consentActive: false,
  errorCode: null
};

export function reduceMonitoring(state: MonitoringState, event: MonitoringEvent): MonitoringState {
  if (event.type === 'SIGNED_OUT') return { ...initialMonitoringState, kind: 'SIGNED_OUT' };
  if (event.type === 'READY')
    return { ...state, kind: 'READY', consentActive: event.consentActive, errorCode: null };
  if (event.type === 'OFFLINE_BUFFERING') return { ...state, kind: 'OFFLINE_BUFFERING' };
  if (event.type === 'SYNC_ERROR') return { ...state, kind: 'SYNC_ERROR', errorCode: event.code };
  if (event.type === 'START_REQUESTED' && state.kind === 'READY' && state.consentActive)
    return { ...state, kind: 'STARTING' };
  if (event.type === 'PAUSE_REQUESTED' && state.kind === 'RECORDING')
    return { ...state, kind: 'PAUSING' };
  if (event.type === 'RESUME_REQUESTED' && state.kind === 'PAUSED')
    return { ...state, kind: 'RESUMING' };
  if (event.type === 'STOP_REQUESTED' && (state.kind === 'RECORDING' || state.kind === 'PAUSED'))
    return { ...state, kind: 'STOPPING' };
  if (event.type === 'REMOTE_CONFIRMED') {
    const kind: Record<RemoteSessionStatus, MonitoringStateKind> = {
      recording: 'RECORDING',
      paused: 'PAUSED',
      completed: 'STOPPED',
      cancelled: 'STOPPED'
    };
    return { ...state, kind: kind[event.status], sessionId: event.sessionId, errorCode: null };
  }
  return state;
}
