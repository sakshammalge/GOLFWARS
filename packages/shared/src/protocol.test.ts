import { describe, expect, it } from 'vitest';
import { MessageType, PROTOCOL_VERSION, roundTripMs } from './protocol.js';

describe('protocol', () => {
  it('has a positive integer protocol version', () => {
    expect(Number.isInteger(PROTOCOL_VERSION)).toBe(true);
    expect(PROTOCOL_VERSION).toBeGreaterThan(0);
  });

  it('names ping and pong messages', () => {
    expect(MessageType.Ping).toBe('ping');
    expect(MessageType.Pong).toBe('pong');
  });

  it('computes non-negative round trip time', () => {
    expect(roundTripMs(100, 142.4)).toBe(42);
    expect(roundTripMs(200, 100)).toBe(0);
  });
});
