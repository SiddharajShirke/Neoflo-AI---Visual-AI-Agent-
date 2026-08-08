import { describe, expect, it, vi } from 'vitest';
import {
  NAVIGATION_ALARM_NAME,
  NavigationAlarmScheduler
} from '../src/navigation/alarm-scheduler.js';

describe('navigation alarm scheduler', () => {
  it('creates one named one-shot alarm at the earliest due time', async () => {
    const create = vi.fn();
    const scheduler = new NavigationAlarmScheduler({ create }, async () => undefined);

    await scheduler.schedule(new Date('2026-08-08T00:00:30.000Z'));

    expect(create).toHaveBeenCalledWith(NAVIGATION_ALARM_NAME, {
      when: Date.parse('2026-08-08T00:00:30.000Z')
    });
  });

  it('ignores unrelated alarms and serializes duplicate delivery wakeups', async () => {
    const create = vi.fn();
    let release: (() => void) | undefined;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const deliver = vi.fn().mockImplementation(async () => wait);
    const scheduler = new NavigationAlarmScheduler({ create }, deliver);

    await scheduler.onAlarm('unrelated');
    const first = scheduler.onAlarm(NAVIGATION_ALARM_NAME);
    const second = scheduler.onAlarm(NAVIGATION_ALARM_NAME);
    release?.();
    await Promise.all([first, second]);

    expect(deliver).toHaveBeenCalledOnce();
  });

  it('recreates a missing navigation alarm during startup recovery', async () => {
    const create = vi.fn();
    const get = vi.fn().mockResolvedValue(undefined);
    const scheduler = new NavigationAlarmScheduler({ create, get }, async () => undefined);

    await scheduler.ensureScheduled(new Date('2026-08-08T00:00:30.000Z'));

    expect(get).toHaveBeenCalledWith(NAVIGATION_ALARM_NAME);
    expect(create).toHaveBeenCalledOnce();
  });
});
