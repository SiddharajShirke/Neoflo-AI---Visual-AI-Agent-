import {
  isApiErrorResponse,
  isConsentCreateRequest,
  isConsentCreateResponse,
  isConsentListResponse,
  isDeletionRequestResponse,
  isDeviceListResponse,
  isDeviceRegisterRequest,
  isDeviceRegisterResponse,
  isMonitoringSessionCreateRequest,
  isMonitoringSessionCreateResponse,
  isMonitoringSessionListResponse,
  isMonitoringSessionResponse,
  isSessionTransitionResponse,
  type ConsentCreateRequest,
  type ConsentCreateResponse,
  type ConsentListResponse,
  type DeletionRequestResponse,
  type DeviceListResponse,
  type DeviceRegisterRequest,
  type DeviceRegisterResponse,
  type MonitoringSessionCreateRequest,
  type MonitoringSessionCreateResponse,
  type MonitoringSessionListResponse,
  type MonitoringSessionResponse,
  type SessionTransitionResponse
} from '@visual-ai/contracts';

type Validator<T> = (value: unknown) => value is T;
type Fetcher = typeof fetch;

export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly retryAfter: string | null = null
  ) {
    super(code);
  }
}

export class ApiClient {
  private readonly baseUrl: string;

  constructor(
    baseUrl: string,
    private readonly accessToken: () => Promise<string | null>,
    private readonly refreshAccessToken: () => Promise<boolean>,
    private readonly fetcher: Fetcher = fetch
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  registerDevice(
    payload: DeviceRegisterRequest,
    idempotencyKey: string
  ): Promise<DeviceRegisterResponse> {
    this.#assertRequest(isDeviceRegisterRequest, payload);
    return this.#request(
      '/api/v1/devices/register',
      'POST',
      isDeviceRegisterResponse,
      payload,
      idempotencyKey
    );
  }
  listDevices(): Promise<DeviceListResponse> {
    return this.#request('/api/v1/devices', 'GET', isDeviceListResponse);
  }
  revokeDevice(deviceId: string): Promise<DeviceRegisterResponse> {
    return this.#request(`/api/v1/devices/${deviceId}/revoke`, 'POST', isDeviceRegisterResponse);
  }
  createConsent(
    payload: ConsentCreateRequest,
    idempotencyKey: string
  ): Promise<ConsentCreateResponse> {
    this.#assertRequest(isConsentCreateRequest, payload);
    return this.#request(
      '/api/v1/consents',
      'POST',
      isConsentCreateResponse,
      payload,
      idempotencyKey
    );
  }
  listConsents(): Promise<ConsentListResponse> {
    return this.#request('/api/v1/consents', 'GET', isConsentListResponse);
  }
  createSession(
    payload: MonitoringSessionCreateRequest,
    idempotencyKey: string
  ): Promise<MonitoringSessionCreateResponse> {
    this.#assertRequest(isMonitoringSessionCreateRequest, payload);
    return this.#request(
      '/api/v1/sessions',
      'POST',
      isMonitoringSessionCreateResponse,
      payload,
      idempotencyKey
    );
  }
  listSessions(): Promise<MonitoringSessionListResponse> {
    return this.#request('/api/v1/sessions', 'GET', isMonitoringSessionListResponse);
  }
  getSession(sessionId: string): Promise<MonitoringSessionResponse> {
    return this.#request(`/api/v1/sessions/${sessionId}`, 'GET', isMonitoringSessionResponse);
  }
  pauseSession(sessionId: string, idempotencyKey: string): Promise<SessionTransitionResponse> {
    return this.#transition(sessionId, 'pause', idempotencyKey);
  }
  resumeSession(sessionId: string, idempotencyKey: string): Promise<SessionTransitionResponse> {
    return this.#transition(sessionId, 'resume', idempotencyKey);
  }
  completeSession(sessionId: string, idempotencyKey: string): Promise<SessionTransitionResponse> {
    return this.#transition(sessionId, 'complete', idempotencyKey);
  }
  cancelSession(sessionId: string, idempotencyKey: string): Promise<SessionTransitionResponse> {
    return this.#transition(sessionId, 'cancel', idempotencyKey);
  }
  requestSessionDeletion(sessionId: string): Promise<DeletionRequestResponse> {
    return this.#request(`/api/v1/sessions/${sessionId}`, 'DELETE', isDeletionRequestResponse);
  }

  #transition(
    sessionId: string,
    action: 'pause' | 'resume' | 'complete' | 'cancel',
    key: string
  ): Promise<SessionTransitionResponse> {
    return this.#request(
      `/api/v1/sessions/${sessionId}/${action}`,
      'POST',
      isSessionTransitionResponse,
      undefined,
      key
    );
  }

  #assertRequest<T>(validator: Validator<T>, payload: unknown): asserts payload is T {
    if (!validator(payload)) throw new ApiClientError(400, 'invalid_request_contract');
  }

  async #request<T>(
    path: string,
    method: 'GET' | 'POST' | 'DELETE',
    validator: Validator<T>,
    body?: unknown,
    idempotencyKey?: string
  ): Promise<T> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const token = await this.accessToken();
      if (!token) throw new ApiClientError(401, 'authentication_required');
      const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
      let response: Response;
      try {
        response = await this.fetcher(`${this.baseUrl}${path}`, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body)
        });
      } catch {
        throw new ApiClientError(0, 'network_error');
      }
      const payload: unknown = await response.json().catch(() => null);
      if (response.status === 401) {
        if (attempt === 0 && (await this.refreshAccessToken())) continue;
        throw new ApiClientError(401, 'authentication_required');
      }
      if (!response.ok) {
        const code = isApiErrorResponse(payload) ? payload.error.code : 'api_error';
        throw new ApiClientError(response.status, code, response.headers.get('Retry-After'));
      }
      if (!validator(payload)) throw new ApiClientError(502, 'invalid_response_contract');
      return payload;
    }
    throw new ApiClientError(401, 'authentication_required');
  }
}
