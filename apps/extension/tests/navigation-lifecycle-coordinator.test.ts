import { describe, expect, it, vi } from 'vitest';
import { CaptureGate } from '../src/navigation/capture-gate.js';
import { NavigationLifecycleCoordinator } from '../src/navigation/lifecycle-coordinator.js';

const context = {
  deviceId: 'device-1',
  sessionId: 'session-1',
  capturePolicyVersion: 'm4-navigation-v1' as const
};

describe('navigation lifecycle coordinator', () => {
  it('drains a captured lease and navigation delivery before requesting remote pause', async () => {
    const gate = new CaptureGate();
    gate.open(context);
    const lease = gate.acquire();
    if (!lease) throw new Error('lease setup failed');
    const order: string[] = [];
    const coordinator = new NavigationLifecycleCoordinator(
      gate,
      {
        closeForLifecycle: vi.fn(async () => {
          order.push('durable-close');
        }),
        formAllBatches: vi.fn(async () => {
          order.push('form');
        }),
        hasPendingForSession: vi.fn(async () => false),
        clearLifecycleIntent: vi.fn(async () => {
          order.push('clear');
        })
      },
      {
        deliverDue: vi.fn(async () => {
          order.push('deliver');
        })
      }
    );
    const remotePause = vi.fn(async () => {
      order.push('pause');
      return true;
    });

    const pause = coordinator.requestPause(context.sessionId, remotePause);
    await Promise.resolve();

    expect(remotePause).not.toHaveBeenCalled();
    expect(order).toEqual(['durable-close']);
    lease.release();
    await pause;

    expect(order).toEqual(['durable-close', 'form', 'deliver', 'pause', 'clear']);
  });

  it('keeps the durable pause intent and blocks the control mutation on non-authority delivery failure', async () => {
    const gate = new CaptureGate();
    gate.open(context);
    const clearLifecycleIntent = vi.fn();
    const coordinator = new NavigationLifecycleCoordinator(
      gate,
      {
        closeForLifecycle: vi.fn(async () => undefined),
        formAllBatches: vi.fn(async () => undefined),
        hasPendingForSession: vi.fn(async () => true),
        clearLifecycleIntent
      },
      { deliverDue: vi.fn(async () => undefined) }
    );
    const remotePause = vi.fn();

    await expect(coordinator.requestPause(context.sessionId, remotePause)).resolves.toBe(false);

    expect(remotePause).not.toHaveBeenCalled();
    expect(clearLifecycleIntent).not.toHaveBeenCalled();
  });

  it('uses the same drain barrier before remote completion', async () => {
    const gate = new CaptureGate();
    gate.open(context);
    const order: string[] = [];
    const coordinator = new NavigationLifecycleCoordinator(
      gate,
      {
        closeForLifecycle: vi.fn(async () => {
          order.push('close');
        }),
        formAllBatches: vi.fn(async () => {
          order.push('form');
        }),
        hasPendingForSession: vi.fn(async () => false),
        clearLifecycleIntent: vi.fn(async () => {
          order.push('clear');
        })
      },
      {
        deliverDue: vi.fn(async () => {
          order.push('deliver');
        })
      }
    );

    await expect(
      coordinator.requestStop(context.sessionId, async () => {
        order.push('complete');
        return true;
      })
    ).resolves.toBe(true);

    expect(order).toEqual(['close', 'form', 'deliver', 'complete', 'clear']);
  });

  it('continues a persisted offline intent after restart without allowing control to overtake delivery', async () => {
    const gate = new CaptureGate();
    const order: string[] = [];
    const coordinator = new NavigationLifecycleCoordinator(
      gate,
      {
        closeForLifecycle: vi.fn(),
        formAllBatches: vi.fn(async () => {
          order.push('form');
        }),
        hasPendingForSession: vi.fn(async () => false),
        clearLifecycleIntent: vi.fn(async () => {
          order.push('clear');
        })
      },
      {
        deliverDue: vi.fn(async () => {
          order.push('deliver');
        })
      }
    );

    await expect(
      coordinator.continuePersisted(
        context.sessionId,
        { ...context, generation: 2 },
        'pause',
        async () => {
          order.push('pause');
          return true;
        }
      )
    ).resolves.toBe(true);

    expect(order).toEqual(['form', 'deliver', 'pause', 'clear']);
  });
});
