import { describe, it, expect } from 'vitest';
import { minuteFloor, timePayload } from '../../../src/tools/time.js';

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

describe('minuteFloor', () => {
  const MIN = 60_000;

  it('passes whole-minute timestamps through unchanged', () => {
    expect(minuteFloor(1_785_925_800_000)).toBe(1_785_925_800_000);
  });

  it('floors sub-minute seconds and ms down to the start of the minute', () => {
    expect(minuteFloor(1_785_925_818_183)).toBe(1_785_925_800_000);
  });

  it('never rounds up across a minute boundary (floor, not round)', () => {
    expect(minuteFloor(1_785_925_800_001)).toBe(1_785_925_800_000);
    expect(minuteFloor(1_785_925_859_999)).toBe(1_785_925_800_000);
  });

  it('result is always a whole-minute multiple', () => {
    for (const ms of [0, 1, 59_999, 60_000, 123_456_789_012, 1_785_925_859_999]) {
      expect(minuteFloor(ms) % MIN).toBe(0);
    }
  });
});
