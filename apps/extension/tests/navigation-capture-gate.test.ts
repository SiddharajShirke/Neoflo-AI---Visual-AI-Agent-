import { describe, expect, it } from 'vitest';
import { CaptureGate } from '../src/navigation/capture-gate.js';

const reconciledRecordingAuthority = {
  deviceId: 'device-1',
  sessionId: 'session-1',
  capturePolicyVersion: 'm4-navigation-v1' as const
};

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
}

describe('CaptureGate', () => {
  it('starts closed', () => {
    expect(new CaptureGate().acquire()).toBeNull();
  });

  it.each([
    'READY',
    'SIGNED_OUT',
    'STARTING',
    'PAUSING',
    'PAUSED',
    'RESUMING',
    'STOPPING',
    'STOPPED',
    'SYNC_ERROR'
  ])('does not lease while the caller has not supplied recording authority (%s)', () => {
    expect(new CaptureGate().acquire()).toBeNull();
  });

  it('opens for authenticated, reconciled recording authority', () => {
    const gate = new CaptureGate();
    const context = gate.open(reconciledRecordingAuthority);
    const lease = gate.acquire();

    expect(context).toEqual({ ...reconciledRecordingAuthority, generation: 1 });
    expect(lease?.context).toEqual(context);
    expect(gate.isCurrent(context)).toBe(true);
  });

  it('opens when transient offline health retains recording authority', () => {
    const gate = new CaptureGate();
    const context = gate.open({
      deviceId: 'device-1',
      sessionId: 'session-1',
      capturePolicyVersion: 'm4-navigation-v1'
    });

    expect(gate.acquire()?.context).toEqual(context);
  });

  it('snapshots immutable authority context and advances generation across transitions', async () => {
    const gate = new CaptureGate();
    const supplied = { ...reconciledRecordingAuthority };
    const first = gate.open(supplied);
    supplied.sessionId = 'changed-after-open';

    await gate.close();
    const second = gate.open(reconciledRecordingAuthority);

    expect(Object.isFrozen(first)).toBe(true);
    expect(first).toEqual({ ...reconciledRecordingAuthority, generation: 1 });
    expect(second).toEqual({ ...reconciledRecordingAuthority, generation: 3 });
    expect(gate.isCurrent(first)).toBe(false);
    expect(gate.isCurrent(second)).toBe(true);
  });

  it('closes synchronously and waits for its active lease to release', async () => {
    const gate = new CaptureGate();
    const context = gate.open(reconciledRecordingAuthority);
    const lease = gate.acquire();
    if (lease === null) throw new Error('expected lease');

    let closeResolved = false;
    const closing = gate.close().then(() => {
      closeResolved = true;
    });

    expect(gate.acquire()).toBeNull();
    expect(gate.isCurrent(context)).toBe(false);
    await Promise.resolve();
    expect(closeResolved).toBe(false);

    lease.release();
    await closing;
    expect(closeResolved).toBe(true);
  });

  it('releases a lease idempotently', async () => {
    const gate = new CaptureGate();
    gate.open(reconciledRecordingAuthority);
    const lease = gate.acquire();
    if (lease === null) throw new Error('expected lease');

    const closing = gate.close();
    lease.release();
    lease.release();

    await expect(closing).resolves.toBeUndefined();
  });

  it('invalidates a handler paused before its final generation check when close wins', async () => {
    const gate = new CaptureGate();
    gate.open(reconciledRecordingAuthority);
    const lease = gate.acquire();
    if (lease === null) throw new Error('expected lease');
    const allowFinalGenerationCheck = deferred<void>();
    let appended = false;

    const handler = (async () => {
      await allowFinalGenerationCheck.promise;
      if (gate.isCurrent(lease.context)) appended = true;
      lease.release();
    })();

    const closing = gate.closeAndDrain();
    expect(gate.acquire()).toBeNull();
    expect(gate.isCurrent(lease.context)).toBe(false);

    allowFinalGenerationCheck.resolve();
    await handler;

    expect(appended).toBe(false);
    await expect(closing).resolves.toEqual({ ...reconciledRecordingAuthority, generation: 2 });
  });

  it('waits for a pre-close lease that has already passed its final generation check', async () => {
    const gate = new CaptureGate();
    gate.open(reconciledRecordingAuthority);
    const appendStarted = deferred<void>();
    const finishAppend = deferred<void>();
    let appended = false;

    const handler = (async () => {
      const lease = gate.acquire();
      if (lease === null) throw new Error('expected lease');
      if (!gate.isCurrent(lease.context)) throw new Error('expected current lease');
      appendStarted.resolve();
      await finishAppend.promise;
      appended = true;
      lease.release();
    })();

    await appendStarted.promise;
    let closeResolved = false;
    const closing = gate.closeAndDrain().then((closedContext) => {
      closeResolved = true;
      return closedContext;
    });

    await Promise.resolve();
    expect(closeResolved).toBe(false);
    expect(appended).toBe(false);

    finishAppend.resolve();
    await handler;

    expect(appended).toBe(true);
    await expect(closing).resolves.toEqual({ ...reconciledRecordingAuthority, generation: 2 });
  });
});
