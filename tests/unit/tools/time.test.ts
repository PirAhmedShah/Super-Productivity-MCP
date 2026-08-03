import { describe, it, expect } from 'vitest';
import { timePayload } from '../../../src/tools/time.js';

describe('timePayload', () => {
  const fixed = new Date(2026, 7, 3, 17, 30, 0, 0);

  it('returns epochMs and local date/time fields', () => {
    const p = timePayload(fixed);
    expect(p.epochMs).toBe(fixed.getTime());
    expect(p.localDate).toBe('2026-08-03');
    expect(p.localTime).toBe('17:30');
    expect(p.dayOfWeek).toBe('Monday');
  });

  it('pads hours and minutes to two digits', () => {
    const p = timePayload(new Date(2026, 0, 5, 9, 5));
    expect(p.localTime).toBe('09:05');
  });

  it('iso is UTC and matches epochMs', () => {
    const p = timePayload(fixed);
    expect(new Date(p.iso).getTime()).toBe(p.epochMs);
  });

  it('timezone is a valid IANA string', () => {
    const p = timePayload(fixed);
    expect(p.timezone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });
});
