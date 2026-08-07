import { describe, expect, it } from 'vitest';
import {
  initialMonitoringState,
  reduceMonitoring,
  type MonitoringState
} from '../src/core/state-machine.js';

describe('monitoring state machine', () => {
  it('moves through a confirmed start, pause, resume, and stop lifecycle', () => {
    let state: MonitoringState = { ...initialMonitoringState, kind: 'READY', consentActive: true };

    state = reduceMonitoring(state, { type: 'START_REQUESTED' });
    expect(state.kind).toBe('STARTING');
    state = reduceMonitoring(state, {
      type: 'REMOTE_CONFIRMED',
      status: 'recording',
      sessionId: 's-1'
    });
    expect(state).toMatchObject({ kind: 'RECORDING', sessionId: 's-1' });
    state = reduceMonitoring(state, { type: 'PAUSE_REQUESTED' });
    expect(state.kind).toBe('PAUSING');
    state = reduceMonitoring(state, {
      type: 'REMOTE_CONFIRMED',
      status: 'paused',
      sessionId: 's-1'
    });
    expect(state.kind).toBe('PAUSED');
    state = reduceMonitoring(state, { type: 'RESUME_REQUESTED' });
    expect(state.kind).toBe('RESUMING');
    state = reduceMonitoring(state, {
      type: 'REMOTE_CONFIRMED',
      status: 'recording',
      sessionId: 's-1'
    });
    state = reduceMonitoring(state, { type: 'STOP_REQUESTED' });
    expect(state.kind).toBe('STOPPING');
    state = reduceMonitoring(state, {
      type: 'REMOTE_CONFIRMED',
      status: 'completed',
      sessionId: 's-1'
    });
    expect(state.kind).toBe('STOPPED');
  });

  it('keeps an invalid transition unchanged', () => {
    const state = { ...initialMonitoringState, kind: 'READY' as const, consentActive: false };
    expect(reduceMonitoring(state, { type: 'START_REQUESTED' })).toEqual(state);
  });

  it.each([
    ['READY', { type: 'PAUSE_REQUESTED' }],
    ['READY', { type: 'RESUME_REQUESTED' }],
    ['READY', { type: 'STOP_REQUESTED' }],
    ['RECORDING', { type: 'START_REQUESTED' }],
    ['PAUSED', { type: 'PAUSE_REQUESTED' }]
  ] as const)(
    'rejects invalid %s state transitions without changing local state',
    (kind, event) => {
      const state: MonitoringState = { ...initialMonitoringState, kind, consentActive: true };
      expect(reduceMonitoring(state, event)).toEqual(state);
    }
  );
});
