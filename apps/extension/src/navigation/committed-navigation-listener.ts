import type { CommittedNavigationDetails } from './committed-navigation-handler.js';

export interface WebNavigationApi {
  onCommitted: {
    addListener(listener: (details: CommittedNavigationDetails) => void): void;
  };
}

/** The only Chrome navigation boundary: details are forwarded directly to the scoped handler. */
export function installCommittedNavigationListener(
  webNavigation: WebNavigationApi,
  handle: (details: CommittedNavigationDetails) => Promise<void>,
  onSafeFailure: () => void | Promise<void> = () => undefined
): void {
  webNavigation.onCommitted.addListener((details) => {
    void handle(details).catch(() => {
      void Promise.resolve(onSafeFailure()).catch(() => undefined);
    });
  });
}
