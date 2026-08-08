import { describe, expect, it, vi } from 'vitest';
import { logNavigation } from '../src/navigation/safe-log.js';

describe('safe navigation logging', () => {
  it('logs only fixed non-content operational metadata', () => {
    const sink = vi.fn();

    logNavigation(
      {
        operation: 'batch_delivery',
        eventCount: 2,
        retryCount: 1,
        errorCode: 'network_error',
        queueDepth: 3
      },
      sink
    );

    expect(sink).toHaveBeenCalledExactlyOnceWith({
      operation: 'batch_delivery',
      eventCount: 2,
      retryCount: 1,
      errorCode: 'network_error',
      queueDepth: 3
    });
  });

  it.each([
    { operation: 'capture', url: 'https://private.example.test/path' },
    { operation: 'capture', hostname: 'private.example.test' },
    { operation: 'capture', pageDomain: 'example.test' },
    { operation: 'capture', Authorization: 'Bearer opaque' },
    { operation: 'capture', body: { events: [] } },
    { operation: 'capture', details: { tabId: 1 } },
    { operation: 'capture', error: new Error('opaque') }
  ])('rejects unsafe or arbitrary log payload %#', (unsafe) => {
    expect(() => logNavigation(unsafe as never, vi.fn())).toThrow('safe navigation log');
  });
});
