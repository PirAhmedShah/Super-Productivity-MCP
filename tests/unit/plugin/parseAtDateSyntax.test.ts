import { describe, it, expect } from 'vitest';
import { parseAtDateSyntax } from '../../../plugin/plugin.js';

// Fixed reference date: Wednesday 2026-07-15
const NOW = new Date(2026, 6, 15, 10, 0, 0);

describe('parseAtDateSyntax', () => {
  it('leaves title untouched when there is no @date syntax', () => {
    expect(parseAtDateSyntax('buy milk', NOW)).toEqual({ dueDay: null, dueWithTime: null, cleanTitle: 'buy milk' });
  });

  it('resolves @today and strips the token', () => {
    expect(parseAtDateSyntax('buy milk @today', NOW)).toEqual({
      dueDay: '2026-07-15',
      dueWithTime: null,
      cleanTitle: 'buy milk',
    });
  });

  it('resolves @tomorrow', () => {
    expect(parseAtDateSyntax('buy milk @tomorrow', NOW).dueDay).toBe('2026-07-16');
  });

  it('resolves @Ndays', () => {
    expect(parseAtDateSyntax('buy milk @3days', NOW).dueDay).toBe('2026-07-18');
  });

  it('resolves a weekday keyword to the next occurrence', () => {
    // NOW is Wednesday; next Monday is 2026-07-20
    expect(parseAtDateSyntax('standup @monday', NOW).dueDay).toBe('2026-07-20');
  });

  it('strips a trailing am/pm time token from the title', () => {
    expect(parseAtDateSyntax('call mom @today 6pm', NOW)).toEqual({
      dueDay: '2026-07-15',
      dueWithTime: new Date(2026, 6, 15, 18, 0, 0).getTime(),
      cleanTitle: 'call mom',
    });
  });

  it('strips a trailing HH:MM time token from the title', () => {
    expect(parseAtDateSyntax('call mom @today 14:30', NOW).cleanTitle).toBe('call mom');
  });

  it('sets dueWithTime for HH:MM 24h tokens', () => {
    expect(parseAtDateSyntax('call mom @today 14:30', NOW).dueWithTime).toBe(new Date(2026, 6, 15, 14, 30, 0).getTime());
  });

  it('sets dueWithTime on the due date for @tomorrow 3pm', () => {
    expect(parseAtDateSyntax('call @tomorrow 3pm', NOW)).toEqual({
      dueDay: '2026-07-16',
      dueWithTime: new Date(2026, 6, 16, 15, 0, 0).getTime(),
      cleanTitle: 'call',
    });
  });

  it('handles 12am -> 00:00 and 12pm -> 12:00', () => {
    expect(parseAtDateSyntax('a @today 12am', NOW).dueWithTime).toBe(new Date(2026, 6, 15, 0, 0, 0).getTime());
    expect(parseAtDateSyntax('b @today 12pm', NOW).dueWithTime).toBe(new Date(2026, 6, 15, 12, 0, 0).getTime());
  });

  it('handles HH:MM am/pm tokens', () => {
    expect(parseAtDateSyntax('c @today 9:30am', NOW).dueWithTime).toBe(new Date(2026, 6, 15, 9, 30, 0).getTime());
    expect(parseAtDateSyntax('d @today 9:30pm', NOW).dueWithTime).toBe(new Date(2026, 6, 15, 21, 30, 0).getTime());
  });

  // Regression: https://github.com/b0x42/Super-Productivity-MCP/issues/78
  // "@today 6h/11h" previously ate the leading digit of the duration syntax,
  // corrupting the title to "test task2 h/11h".
  it('does not eat a leading digit from adjacent duration syntax (#78)', () => {
    expect(parseAtDateSyntax('test task2 @today 6h/11h', NOW)).toEqual({
      dueDay: '2026-07-15',
      dueWithTime: null,
      cleanTitle: 'test task2 6h/11h',
    });
  });

  it('does not mistake a bare-hour duration (e.g. 14h) for a time-of-day', () => {
    expect(parseAtDateSyntax('test task2 @today 14h duration', NOW).cleanTitle).toBe(
      'test task2 14h duration',
    );
    expect(parseAtDateSyntax('test task2 @today 14h duration', NOW).dueWithTime).toBeNull();
  });

  it('still strips the time token when followed directly by punctuation', () => {
    expect(parseAtDateSyntax('buy milk @today 6pm, need for dinner', NOW).cleanTitle).toBe(
      'buy milk , need for dinner',
    );
  });

  it('collapses the double space left after stripping a mid-title @date token', () => {
    expect(parseAtDateSyntax('buy @today milk', NOW).cleanTitle).toBe('buy milk');
  });
});
