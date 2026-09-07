import { describe, expect, it } from 'vitest';
import { canDeleteRoom } from './roomAuthorization';

describe('room deletion authorization', () => {
  it('allows the authenticated creator', () => {
    expect(canDeleteRoom('creator', 'creator', false)).toBe(true);
  });

  it('rejects unauthenticated and mismatched users', () => {
    expect(canDeleteRoom(undefined, 'creator', false)).toBe(false);
    expect(canDeleteRoom('attacker', 'creator', false)).toBe(false);
  });

  it('allows an authenticated admin independently of room ownership', () => {
    expect(canDeleteRoom('admin', 'creator', true)).toBe(true);
  });
});
