import { describe, expect, it } from 'vitest';
import consentRequest from '../../../schemas/api/fixtures/consent-create-request.v1.valid.json';
import consentResponse from '../../../schemas/api/fixtures/consent-create-response.v1.valid.json';
import deletionResponse from '../../../schemas/api/fixtures/deletion-request-response.v1.valid.json';
import deviceRequest from '../../../schemas/api/fixtures/device-register-request.v1.valid.json';
import errorResponse from '../../../schemas/api/fixtures/error-response.v1.valid.json';
import sessionRequest from '../../../schemas/api/fixtures/monitoring-session-create-request.v1.valid.json';
import sessionResponse from '../../../schemas/api/fixtures/monitoring-session-create-response.v1.valid.json';
import transitionResponse from '../../../schemas/api/fixtures/session-transition-response.v1.valid.json';
import * as contracts from '../src/index.js';

describe('control-plane contracts', () => {
  it('exports a validator for the canonical device registration request', () => {
    expect('isDeviceRegisterRequest' in contracts).toBe(true);
  });

  it('accepts shared control-plane fixtures and rejects unknown properties', () => {
    const validators = contracts as typeof contracts & {
      isApiErrorResponse(value: unknown): boolean;
      isConsentCreateRequest(value: unknown): boolean;
      isConsentCreateResponse(value: unknown): boolean;
      isDeletionRequestResponse(value: unknown): boolean;
      isDeviceRegisterRequest(value: unknown): boolean;
      isMonitoringSessionCreateRequest(value: unknown): boolean;
      isMonitoringSessionCreateResponse(value: unknown): boolean;
      isSessionTransitionResponse(value: unknown): boolean;
    };

    expect(validators.isDeviceRegisterRequest(deviceRequest)).toBe(true);
    expect(validators.isConsentCreateRequest(consentRequest)).toBe(true);
    expect(validators.isConsentCreateResponse(consentResponse)).toBe(true);
    expect(validators.isMonitoringSessionCreateRequest(sessionRequest)).toBe(true);
    expect(validators.isMonitoringSessionCreateResponse(sessionResponse)).toBe(true);
    expect(validators.isSessionTransitionResponse(transitionResponse)).toBe(true);
    expect(validators.isDeletionRequestResponse(deletionResponse)).toBe(true);
    expect(validators.isApiErrorResponse(errorResponse)).toBe(true);
    expect(
      validators.isConsentCreateRequest({ ...consentRequest, raw_url: 'https://x.test' })
    ).toBe(false);
  });
});
