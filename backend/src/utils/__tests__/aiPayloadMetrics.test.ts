import { jsonByteLength, providerPayloadBreakdown, utf8ByteLength } from '../aiPayloadMetrics.js';

describe('AI payload metrics', () => {
  it('measures UTF-8 bytes rather than JavaScript characters', () => {
    expect(utf8ByteLength('é')).toBe(2);
  });

  it('measures the serialized JSON payload', () => {
    expect(jsonByteLength({ message: 'hello' })).toBe(Buffer.byteLength('{"message":"hello"}', 'utf8'));
  });

  it('extracts message/tool counts and byte sizes without retaining content', () => {
    const body = JSON.stringify({
      model: 'test',
      messages: [{ role: 'user', content: 'private prompt' }],
      tools: [{ type: 'function', function: { name: 'search' } }],
    });

    expect(providerPayloadBreakdown(body)).toEqual({
      messagesBytes: jsonByteLength([{ role: 'user', content: 'private prompt' }]),
      toolsBytes: jsonByteLength([{ type: 'function', function: { name: 'search' } }]),
      messageCount: 1,
      toolCount: 1,
    });
  });

  it('returns an empty breakdown for a non-JSON body', () => {
    expect(providerPayloadBreakdown('not-json')).toEqual({});
  });
});
