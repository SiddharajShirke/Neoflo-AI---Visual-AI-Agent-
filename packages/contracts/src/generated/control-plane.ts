/* This file is generated from versioned schemas/api control-plane contracts. DO NOT EDIT. */

export type DeviceRegisterRequest = {
  installation_id: string;
  label?: string | null;
  client_version?: string | null;
};

export type DeviceRegisterResponse = { id: string; status: 'active' | 'revoked' };

export type DeviceListResponse = {
  devices: { id: string; status: 'active' | 'revoked'; label: string | null }[];
};

export type ConsentCreateRequest = {
  device_id: string;
  scope: 'monitoring' | 'screenshots' | 'privacy_notice' | 'retention';
  policy_version: string;
  granted: boolean;
};

export type ConsentCreateResponse = {
  id: string;
  scope: 'monitoring' | 'screenshots' | 'privacy_notice' | 'retention';
  granted: 'true' | 'false';
};

export type ConsentListResponse = {
  consents: {
    id: string;
    device_id: string;
    scope: 'monitoring' | 'screenshots' | 'privacy_notice' | 'retention';
    granted: boolean;
  }[];
};

export type MonitoringSessionCreateRequest = {
  device_id: string;
  monitoring_consent_id: string;
  screenshot_consent_id?: string | null;
  capture_policy_version: string;
  started_at: string;
};

export type MonitoringSessionResponse = {
  id: string;
  status: 'recording' | 'paused' | 'completed' | 'cancelled';
};

export type MonitoringSessionCreateResponse = {
  id: string;
  status: 'recording' | 'paused' | 'completed' | 'cancelled';
  screenshot_capture: 'not_implemented';
};

export type MonitoringSessionListResponse = {
  sessions: {
    id: string;
    device_id: string;
    status: 'recording' | 'paused' | 'completed' | 'cancelled';
  }[];
};

export type SessionTransitionResponse = {
  id: string;
  status: 'recording' | 'paused' | 'completed' | 'cancelled';
};

export type DeletionRequestResponse = { deletion_request_id: string; status: 'requested' };

export type ApiErrorResponse = { error: { code: string; message: string; request_id: string } };

type Schema = Record<string, unknown>;

const schemas = {
  DeviceRegisterRequest: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://visual-ai.example/schemas/api/device-register-request.v1.schema.json',
    title: 'DeviceRegisterRequest',
    type: 'object',
    additionalProperties: false,
    required: ['installation_id'],
    properties: {
      installation_id: {
        type: 'string',
        minLength: 16,
        maxLength: 255
      },
      label: {
        type: ['string', 'null'],
        minLength: 1,
        maxLength: 120
      },
      client_version: {
        type: ['string', 'null'],
        minLength: 1,
        maxLength: 64
      }
    }
  },
  DeviceRegisterResponse: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://visual-ai.example/schemas/api/device-register-response.v1.schema.json',
    title: 'DeviceRegisterResponse',
    type: 'object',
    additionalProperties: false,
    required: ['id', 'status'],
    properties: {
      id: {
        type: 'string',
        format: 'uuid'
      },
      status: {
        type: 'string',
        enum: ['active', 'revoked']
      }
    }
  },
  DeviceListResponse: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://visual-ai.example/schemas/api/device-list-response.v1.schema.json',
    title: 'DeviceListResponse',
    type: 'object',
    additionalProperties: false,
    required: ['devices'],
    properties: {
      devices: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'status', 'label'],
          properties: {
            id: {
              type: 'string',
              format: 'uuid'
            },
            status: {
              type: 'string',
              enum: ['active', 'revoked']
            },
            label: {
              type: ['string', 'null']
            }
          }
        }
      }
    }
  },
  ConsentCreateRequest: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://visual-ai.example/schemas/api/consent-create-request.v1.schema.json',
    title: 'ConsentCreateRequest',
    type: 'object',
    additionalProperties: false,
    required: ['device_id', 'scope', 'policy_version', 'granted'],
    properties: {
      device_id: {
        type: 'string',
        format: 'uuid'
      },
      scope: {
        type: 'string',
        enum: ['monitoring', 'screenshots', 'privacy_notice', 'retention']
      },
      policy_version: {
        type: 'string',
        minLength: 1,
        maxLength: 64
      },
      granted: {
        type: 'boolean'
      }
    }
  },
  ConsentCreateResponse: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://visual-ai.example/schemas/api/consent-create-response.v1.schema.json',
    title: 'ConsentCreateResponse',
    type: 'object',
    additionalProperties: false,
    required: ['id', 'scope', 'granted'],
    properties: {
      id: {
        type: 'string',
        format: 'uuid'
      },
      scope: {
        type: 'string',
        enum: ['monitoring', 'screenshots', 'privacy_notice', 'retention']
      },
      granted: {
        type: 'string',
        enum: ['true', 'false']
      }
    }
  },
  ConsentListResponse: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://visual-ai.example/schemas/api/consent-list-response.v1.schema.json',
    title: 'ConsentListResponse',
    type: 'object',
    additionalProperties: false,
    required: ['consents'],
    properties: {
      consents: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'device_id', 'scope', 'granted'],
          properties: {
            id: {
              type: 'string',
              format: 'uuid'
            },
            device_id: {
              type: 'string',
              format: 'uuid'
            },
            scope: {
              type: 'string',
              enum: ['monitoring', 'screenshots', 'privacy_notice', 'retention']
            },
            granted: {
              type: 'boolean'
            }
          }
        }
      }
    }
  },
  MonitoringSessionCreateRequest: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://visual-ai.example/schemas/api/monitoring-session-create-request.v1.schema.json',
    title: 'MonitoringSessionCreateRequest',
    type: 'object',
    additionalProperties: false,
    required: ['device_id', 'monitoring_consent_id', 'capture_policy_version', 'started_at'],
    properties: {
      device_id: {
        type: 'string',
        format: 'uuid'
      },
      monitoring_consent_id: {
        type: 'string',
        format: 'uuid'
      },
      screenshot_consent_id: {
        type: ['string', 'null'],
        format: 'uuid'
      },
      capture_policy_version: {
        type: 'string',
        minLength: 1,
        maxLength: 64
      },
      started_at: {
        type: 'string',
        format: 'date-time'
      }
    }
  },
  MonitoringSessionResponse: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://visual-ai.example/schemas/api/monitoring-session-response.v1.schema.json',
    title: 'MonitoringSessionResponse',
    type: 'object',
    additionalProperties: false,
    required: ['id', 'status'],
    properties: {
      id: {
        type: 'string',
        format: 'uuid'
      },
      status: {
        type: 'string',
        enum: ['recording', 'paused', 'completed', 'cancelled']
      }
    }
  },
  MonitoringSessionCreateResponse: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://visual-ai.example/schemas/api/monitoring-session-create-response.v1.schema.json',
    title: 'MonitoringSessionCreateResponse',
    type: 'object',
    additionalProperties: false,
    required: ['id', 'status', 'screenshot_capture'],
    properties: {
      id: {
        type: 'string',
        format: 'uuid'
      },
      status: {
        type: 'string',
        enum: ['recording', 'paused', 'completed', 'cancelled']
      },
      screenshot_capture: {
        const: 'not_implemented'
      }
    }
  },
  MonitoringSessionListResponse: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://visual-ai.example/schemas/api/monitoring-session-list-response.v1.schema.json',
    title: 'MonitoringSessionListResponse',
    type: 'object',
    additionalProperties: false,
    required: ['sessions'],
    properties: {
      sessions: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'device_id', 'status'],
          properties: {
            id: {
              type: 'string',
              format: 'uuid'
            },
            device_id: {
              type: 'string',
              format: 'uuid'
            },
            status: {
              type: 'string',
              enum: ['recording', 'paused', 'completed', 'cancelled']
            }
          }
        }
      }
    }
  },
  SessionTransitionResponse: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://visual-ai.example/schemas/api/session-transition-response.v1.schema.json',
    title: 'SessionTransitionResponse',
    type: 'object',
    additionalProperties: false,
    required: ['id', 'status'],
    properties: {
      id: {
        type: 'string',
        format: 'uuid'
      },
      status: {
        type: 'string',
        enum: ['recording', 'paused', 'completed', 'cancelled']
      }
    }
  },
  DeletionRequestResponse: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://visual-ai.example/schemas/api/deletion-request-response.v1.schema.json',
    title: 'DeletionRequestResponse',
    type: 'object',
    additionalProperties: false,
    required: ['deletion_request_id', 'status'],
    properties: {
      deletion_request_id: {
        type: 'string',
        format: 'uuid'
      },
      status: {
        const: 'requested'
      }
    }
  },
  ApiErrorResponse: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://visual-ai.example/schemas/api/error-response.v1.schema.json',
    title: 'ApiErrorResponse',
    type: 'object',
    additionalProperties: false,
    required: ['error'],
    properties: {
      error: {
        type: 'object',
        additionalProperties: false,
        required: ['code', 'message', 'request_id'],
        properties: {
          code: {
            type: 'string',
            minLength: 1,
            maxLength: 80
          },
          message: {
            type: 'string',
            minLength: 1,
            maxLength: 256
          },
          request_id: {
            type: 'string',
            minLength: 1,
            maxLength: 128
          }
        }
      }
    }
  }
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function matchesSchema(value: unknown, schema: Schema): boolean {
  if (Object.hasOwn(schema, 'const') && value !== schema.const) return false;
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) return false;
  const allowedTypes = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (!allowedTypes.some((type) => matchesType(value, type, schema))) return false;
  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) return false;
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) return false;
    if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern).test(value)) return false;
    if (
      schema.format === 'uuid' &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    )
      return false;
    if (schema.format === 'date-time' && Number.isNaN(Date.parse(value))) return false;
  }
  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) return false;
    if (typeof schema.maximum === 'number' && value > schema.maximum) return false;
  }
  if (Array.isArray(value) && isRecord(schema.items))
    return value.every((item) => matchesSchema(item, schema.items as Schema));
  if (isRecord(value) && schema.type === 'object') {
    const properties = isRecord(schema.properties) ? schema.properties : {};
    const required = Array.isArray(schema.required) ? schema.required : [];
    if (required.some((field) => typeof field !== 'string' || !(field in value))) return false;
    if (
      schema.additionalProperties === false &&
      Object.keys(value).some((field) => !(field in properties))
    )
      return false;
    return Object.entries(properties).every(
      ([field, fieldSchema]) =>
        !(field in value) || (isRecord(fieldSchema) && matchesSchema(value[field], fieldSchema))
    );
  }
  return true;
}

function matchesType(value: unknown, type: unknown, schema: Schema): boolean {
  if (type === 'null') return value === null;
  if (type === 'string') return typeof value === 'string';
  if (type === 'boolean') return typeof value === 'boolean';
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'integer') return Number.isInteger(value);
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return isRecord(value);
  return schema.type === undefined;
}

export function isDeviceRegisterRequest(value: unknown): value is DeviceRegisterRequest {
  return matchesSchema(value, schemas.DeviceRegisterRequest);
}

export function isDeviceRegisterResponse(value: unknown): value is DeviceRegisterResponse {
  return matchesSchema(value, schemas.DeviceRegisterResponse);
}

export function isDeviceListResponse(value: unknown): value is DeviceListResponse {
  return matchesSchema(value, schemas.DeviceListResponse);
}

export function isConsentCreateRequest(value: unknown): value is ConsentCreateRequest {
  return matchesSchema(value, schemas.ConsentCreateRequest);
}

export function isConsentCreateResponse(value: unknown): value is ConsentCreateResponse {
  return matchesSchema(value, schemas.ConsentCreateResponse);
}

export function isConsentListResponse(value: unknown): value is ConsentListResponse {
  return matchesSchema(value, schemas.ConsentListResponse);
}

export function isMonitoringSessionCreateRequest(
  value: unknown
): value is MonitoringSessionCreateRequest {
  return matchesSchema(value, schemas.MonitoringSessionCreateRequest);
}

export function isMonitoringSessionResponse(value: unknown): value is MonitoringSessionResponse {
  return matchesSchema(value, schemas.MonitoringSessionResponse);
}

export function isMonitoringSessionCreateResponse(
  value: unknown
): value is MonitoringSessionCreateResponse {
  return matchesSchema(value, schemas.MonitoringSessionCreateResponse);
}

export function isMonitoringSessionListResponse(
  value: unknown
): value is MonitoringSessionListResponse {
  return matchesSchema(value, schemas.MonitoringSessionListResponse);
}

export function isSessionTransitionResponse(value: unknown): value is SessionTransitionResponse {
  return matchesSchema(value, schemas.SessionTransitionResponse);
}

export function isDeletionRequestResponse(value: unknown): value is DeletionRequestResponse {
  return matchesSchema(value, schemas.DeletionRequestResponse);
}

export function isApiErrorResponse(value: unknown): value is ApiErrorResponse {
  return matchesSchema(value, schemas.ApiErrorResponse);
}
