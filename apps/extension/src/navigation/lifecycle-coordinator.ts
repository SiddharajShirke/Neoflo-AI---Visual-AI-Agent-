import type { CaptureContext, CaptureGate } from './capture-gate.js';

export type NavigationLifecycleIntent = 'pause' | 'complete';

export interface NavigationLifecycleRepository {
  closeForLifecycle(sessionId: string, intent: NavigationLifecycleIntent): Promise<void>;
  formAllBatches(sessionId: string, context: CaptureContext): Promise<void>;
  hasPendingForSession(sessionId: string): Promise<boolean>;
  clearLifecycleIntent(sessionId: string, intent: NavigationLifecycleIntent): Promise<void>;
}

export interface NavigationLifecycleDelivery {
  deliverDue(): Promise<void>;
}

/**
 * Serializes browser-event draining ahead of pause/complete control-plane calls.
 * A false result deliberately retains the durable intent for restart-safe recovery.
 */
export class NavigationLifecycleCoordinator {
  private running = false;

  constructor(
    private readonly gate: CaptureGate,
    private readonly repository: NavigationLifecycleRepository,
    private readonly delivery: NavigationLifecycleDelivery
  ) {}

  requestPause(sessionId: string, sendPause: () => Promise<boolean>): Promise<boolean> {
    return this.request(sessionId, 'pause', sendPause);
  }

  requestStop(sessionId: string, sendComplete: () => Promise<boolean>): Promise<boolean> {
    return this.request(sessionId, 'complete', sendComplete);
  }

  async continuePersisted(
    sessionId: string,
    context: CaptureContext,
    intent: NavigationLifecycleIntent,
    sendControl: () => Promise<boolean>
  ): Promise<boolean> {
    if (this.running) return false;
    this.running = true;
    try {
      return await this.drainThenControl(sessionId, context, intent, sendControl);
    } finally {
      this.running = false;
    }
  }

  private async request(
    sessionId: string,
    intent: NavigationLifecycleIntent,
    sendControl: () => Promise<boolean>
  ): Promise<boolean> {
    if (this.running) return false;
    this.running = true;
    try {
      // closeAndDrain closes synchronously before returning its lease-drain promise.
      const drained = this.gate.closeAndDrain();
      await this.repository.closeForLifecycle(sessionId, intent);
      const closedContext = await drained;
      if (closedContext === null || closedContext.sessionId !== sessionId) return false;
      return this.drainThenControl(sessionId, closedContext, intent, sendControl);
    } finally {
      this.running = false;
    }
  }

  private async drainThenControl(
    sessionId: string,
    context: CaptureContext,
    intent: NavigationLifecycleIntent,
    sendControl: () => Promise<boolean>
  ): Promise<boolean> {
    await this.repository.formAllBatches(sessionId, context);
    await this.delivery.deliverDue();
    if (await this.repository.hasPendingForSession(sessionId)) return false;
    if (!(await sendControl())) return false;
    await this.repository.clearLifecycleIntent(sessionId, intent);
    return true;
  }
}
