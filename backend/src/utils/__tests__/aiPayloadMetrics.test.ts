import { jsonByteLength, utf8ByteLength } from '../aiPayloadMetrics.js';

describe('AI payload metrics', () => {
  it('measures UTF-8 bytes rather than JavaScript characters', () => {
    expect(utf8ByteLength('é')).toBe(2);
  });

  it('measures the serialized JSON payload', () => {
    expect(jsonByteLength({ message: 'hello' })).toBe(Buffer.byteLength('{"message":"hello"}', 'utf8'));
  });
});
