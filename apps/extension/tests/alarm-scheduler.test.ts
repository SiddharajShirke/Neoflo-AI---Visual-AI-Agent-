import { describe, expect, it, vi } from 'vitest';
import { QueueAlarmScheduler, RETRY_ALARM_NAME } from '../src/queue/alarm-scheduler.js';

describe('queue alarm scheduler', () => {
  it('uses one explicit durable alarm and serializes duplicate wakeups', async () => {
    const create = vi.fn();
    const deliver = vi.fn().mockResolvedValue(undefined);
    const scheduler = new QueueAlarmScheduler({ create }, deliver);
    await scheduler.schedule(new Date('2026-08-07T00:00:30.000Z'));
    expect(create).toHaveBeenCalledWith(RETRY_ALARM_NAME, {
      when: Date.parse('2026-08-07T00:00:30.000Z')
    });
    await Promise.all([scheduler.onAlarm(RETRY_ALARM_NAME), scheduler.onAlarm(RETRY_ALARM_NAME)]);
    expect(deliver).toHaveBeenCalledTimes(1);
  });
});
