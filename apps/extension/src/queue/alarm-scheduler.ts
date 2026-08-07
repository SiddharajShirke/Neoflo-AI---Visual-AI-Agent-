export const RETRY_ALARM_NAME = 'visual-ai-control-plane-retry-v1';

export interface AlarmApi {
  create(name: string, info: { when: number }): void | Promise<void>;
}

/** Chrome alarms survive worker suspension; this class intentionally owns no timers. */
export class QueueAlarmScheduler {
  private running = false;

  constructor(
    private readonly alarms: AlarmApi,
    private readonly deliver: () => Promise<void>
  ) {}

  async schedule(nextRetryAt: Date): Promise<void> {
    await this.alarms.create(RETRY_ALARM_NAME, { when: nextRetryAt.getTime() });
  }

  async onAlarm(name: string): Promise<void> {
    if (name !== RETRY_ALARM_NAME || this.running) return;
    this.running = true;
    try {
      await this.deliver();
    } finally {
      this.running = false;
    }
  }
}
