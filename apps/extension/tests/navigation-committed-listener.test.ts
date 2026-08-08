import { describe, expect, it, vi } from 'vitest';
import { CaptureGate } from '../src/navigation/capture-gate.js';
import { installCommittedNavigationListener } from '../src/navigation/committed-navigation-listener.js';

describe('committed navigation listener', () => {
  it('installs one typed onCommitted listener and forwards details only to the navigation handler', async () => {
    let listener: ((details: unknown) => void) | undefined;
    const addListener = vi.fn((value: (details: unknown) => void) => {
      listener = value;
    });
    const handle = vi.fn(async () => undefined);
    const logs = [vi.spyOn(console, 'log'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'error')];
    const details = {
      frameId: 0,
      url: 'https://www.example.test/private/path?synthetic=query#fragment',
      transitionType: 'link',
      documentId: 'synthetic-document',
      tabId: 5,
      timeStamp: 1
    };

    installCommittedNavigationListener({ onCommitted: { addListener } }, handle);
    listener?.(details);
    await vi.waitFor(() => expect(handle).toHaveBeenCalledExactlyOnceWith(details));

    expect(addListener).toHaveBeenCalledOnce();
    expect(logs.every((log) => log.mock.calls.length === 0)).toBe(true);
    logs.forEach((log) => log.mockRestore());
  });

  it('contains a handler rejection through a content-free failure boundary', async () => {
    let listener: ((details: unknown) => void) | undefined;
    const gate = new CaptureGate();
    gate.open({
      deviceId: 'device-1',
      sessionId: 'session-1',
      capturePolicyVersion: 'm4-navigation-v1'
    });
    const onSafeFailure = vi.fn(async () => {
      await gate.close();
    });
    const logs = [vi.spyOn(console, 'log'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'error')];

    (
      installCommittedNavigationListener as unknown as (
        api: { onCommitted: { addListener(listener: (details: unknown) => void): void } },
        handle: (details: never) => Promise<void>,
        onFailure: () => Promise<void>
      ) => void
    )(
      { onCommitted: { addListener: (value) => (listener = value) } },
      async () => {
        throw new Error('https://synthetic.example/private?secret=value');
      },
      onSafeFailure
    );

    listener?.({ frameId: 0, url: 'https://synthetic.example/private?secret=value' });
    await vi.waitFor(() => expect(onSafeFailure).toHaveBeenCalledOnce());

    expect(gate.acquire()).toBeNull();
    expect(logs.every((log) => log.mock.calls.length === 0)).toBe(true);
    logs.forEach((log) => log.mockRestore());
  });
});
