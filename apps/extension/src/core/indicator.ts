export interface Indicator {
  text: string;
  title: string;
}

export function indicatorFor(kind: string): Indicator {
  const indicators: Record<string, Indicator> = {
    READY: { text: '', title: 'Ready — monitoring off' },
    RECORDING: { text: 'ON', title: 'Monitoring session active' },
    PAUSED: { text: 'II', title: 'Monitoring session paused' },
    OFFLINE_BUFFERING: { text: '…', title: 'Changes awaiting synchronization' },
    SYNC_ERROR: { text: '!', title: 'Monitoring synchronization needs attention' },
    SIGNED_OUT: { text: '', title: 'Sign in required' }
  };
  return indicators[kind] ?? { text: '', title: 'Monitoring unavailable' };
}
