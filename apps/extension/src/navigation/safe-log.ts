export type SafeNavigationLog = {
  operation: string;
  eventCount?: number;
  retryCount?: number;
  errorCode?: string;
  requestId?: string;
  queueDepth?: number;
};

const keys = new Set([
  'operation',
  'eventCount',
  'retryCount',
  'errorCode',
  'requestId',
  'queueDepth'
]);

function safeInteger(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isSafeLog(value: unknown): value is SafeNavigationLog {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (!Object.keys(record).every((key) => keys.has(key)) || typeof record.operation !== 'string')
    return false;
  if (record.operation.length === 0 || record.operation.length > 64) return false;
  return (
    (record.eventCount === undefined || safeInteger(record.eventCount)) &&
    (record.retryCount === undefined || safeInteger(record.retryCount)) &&
    (record.queueDepth === undefined || safeInteger(record.queueDepth)) &&
    (record.errorCode === undefined ||
      (typeof record.errorCode === 'string' && record.errorCode.length <= 64)) &&
    (record.requestId === undefined ||
      (typeof record.requestId === 'string' && record.requestId.length <= 64))
  );
}

/** Rejects browser content and arbitrary Error objects before any navigation diagnostic is emitted. */
export function logNavigation(
  value: SafeNavigationLog,
  sink: (value: SafeNavigationLog) => void = console.info
): void {
  if (!isSafeLog(value)) throw new Error('safe navigation log rejected');
  sink({ ...value });
}
