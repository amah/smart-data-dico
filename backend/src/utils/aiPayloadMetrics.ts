import { logger } from './logger.js';

export interface AIProviderRequestMeasurement {
  provider: string;
  model: string;
  diagnosticId: string | null;
  endpoint: string;
  requestBodyBytes: number;
  contentLengthHeader?: string | null;
  step?: number;
  phase?: string;
  messagesBytes?: number;
  toolsBytes?: number;
  messageCount?: number;
  toolCount?: number;
}

const recentMeasurements = new Map<string, AIProviderRequestMeasurement>();

export function recordProviderRequestMeasurement(measurement: AIProviderRequestMeasurement): void {
  logger.info('AI provider request size', measurement);
  if (!measurement.diagnosticId) return;
  recentMeasurements.set(measurement.diagnosticId, measurement);
  if (recentMeasurements.size > 100) {
    const oldest = recentMeasurements.keys().next().value;
    if (oldest) recentMeasurements.delete(oldest);
  }
}

export function getProviderRequestMeasurement(diagnosticId: string): AIProviderRequestMeasurement | undefined {
  return recentMeasurements.get(diagnosticId);
}

export function utf8ByteLength(value: string | undefined): number {
  return Buffer.byteLength(value ?? '', 'utf8');
}

export function jsonByteLength(value: unknown): number {
  try {
    return utf8ByteLength(JSON.stringify(value));
  } catch {
    return -1;
  }
}

/** Derive non-sensitive shape/size metrics from a serialized provider body. */
export function providerPayloadBreakdown(body: string): Pick<
  AIProviderRequestMeasurement,
  'messagesBytes' | 'toolsBytes' | 'messageCount' | 'toolCount'
> {
  try {
    const parsed = JSON.parse(body) as { messages?: unknown; tools?: unknown };
    const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
    const tools = Array.isArray(parsed.tools) ? parsed.tools : [];
    return {
      messagesBytes: jsonByteLength(messages),
      toolsBytes: jsonByteLength(tools),
      messageCount: messages.length,
      toolCount: tools.length,
    };
  } catch {
    return {};
  }
}

/**
 * Wrap an AI SDK provider's fetch so the final serialized request size is
 * visible without logging prompts, messages, tool arguments, or credentials.
 */
export function createMeasuredProviderFetch(provider: string, model: string, diagnosticId?: string): typeof fetch {
  return async (input, init) => {
    const body = init?.body;
    let requestBodyBytes = -1;
    if (typeof body === 'string') requestBodyBytes = utf8ByteLength(body);
    else if (body instanceof URLSearchParams) requestBodyBytes = utf8ByteLength(body.toString());
    else if (body instanceof Uint8Array) requestBodyBytes = body.byteLength;
    else if (body instanceof ArrayBuffer) requestBodyBytes = body.byteLength;

    const rawUrl = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
    let endpoint = rawUrl;
    try {
      const url = new URL(rawUrl);
      endpoint = `${url.host}${url.pathname}`;
    } catch { /* retain the non-sensitive raw value */ }

    const breakdown = typeof body === 'string' ? providerPayloadBreakdown(body) : {};
    recordProviderRequestMeasurement({
      provider,
      model,
      diagnosticId: diagnosticId ?? null,
      endpoint,
      requestBodyBytes,
      contentLengthHeader: new Headers(init?.headers).get('content-length'),
      ...breakdown,
    });

    return fetch(input, init);
  };
}
