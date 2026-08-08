export const NAVIGATION_ALARM_NAME = 'visual-ai-navigation-v1';

export interface NavigationAlarmApi {
  create(name: string, info: { when: number }): void | Promise<void>;
  get?(name: string): Promise<{ scheduledTime?: number } | undefined>;
}

/** Durable one-shot scheduling; Chrome may deliver later than 30 seconds but never depends on timers. */
export class NavigationAlarmScheduler {
  private running = false;

  constructor(
    private readonly alarms: NavigationAlarmApi,
    private readonly deliver: () => Promise<void>
  ) {}

  async schedule(when: Date): Promise<void> {
    await this.alarms.create(NAVIGATION_ALARM_NAME, { when: when.getTime() });
  }

  async ensureScheduled(when: Date): Promise<void> {
    const existing = await this.alarms.get?.(NAVIGATION_ALARM_NAME);
    if (existing === undefined) await this.schedule(when);
  }

  async onAlarm(name: string): Promise<void> {
    if (name !== NAVIGATION_ALARM_NAME || this.running) return;
    this.running = true;
    try {
      await this.deliver();
    } finally {
      this.running = false;
    }
  }
}
