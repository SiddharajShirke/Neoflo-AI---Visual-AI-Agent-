export interface CaptureContext {
  readonly generation: number;
  readonly deviceId: string;
  readonly sessionId: string;
  readonly capturePolicyVersion: 'm4-navigation-v1';
}

export interface CaptureLease {
  readonly context: CaptureContext;
  release(): void;
}

export class CaptureGate {
  private activeContext: CaptureContext | null = null;
  private generation = 0;
  private leaseCount = 0;
  private readonly drainResolvers = new Set<() => void>();

  open(context: Omit<CaptureContext, 'generation'>): CaptureContext {
    const snapshot = Object.freeze({ ...context, generation: ++this.generation });
    this.activeContext = snapshot;
    return snapshot;
  }

  close(): Promise<void> {
    return this.closeAndDrain().then(() => undefined);
  }

  closeAndDrain(): Promise<CaptureContext | null> {
    const active = this.activeContext;
    this.generation++;
    this.activeContext = null;
    const closedContext =
      active === null ? null : Object.freeze({ ...active, generation: this.generation });

    if (this.leaseCount === 0) return Promise.resolve(closedContext);

    return new Promise((resolve) => this.drainResolvers.add(() => resolve(closedContext)));
  }

  acquire(): CaptureLease | null {
    const context = this.activeContext;
    if (context === null) return null;

    this.leaseCount++;
    let released = false;
    return {
      context,
      release: () => {
        if (released) return;
        released = true;
        this.leaseCount--;
        if (this.leaseCount !== 0) return;
        for (const resolve of this.drainResolvers) resolve();
        this.drainResolvers.clear();
      }
    };
  }

  isCurrent(context: CaptureContext): boolean {
    const active = this.activeContext;
    return (
      active !== null &&
      active.generation === context.generation &&
      active.deviceId === context.deviceId &&
      active.sessionId === context.sessionId &&
      active.capturePolicyVersion === context.capturePolicyVersion
    );
  }
}
