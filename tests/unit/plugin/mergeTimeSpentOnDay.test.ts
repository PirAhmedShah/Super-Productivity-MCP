import { describe, it, expect } from 'vitest';
import { mergeTimeSpentOnDay } from '../../../plugin/plugin.js';

// Regression: plugin 1.7.3 added time_spent_on_day to update_task so the per-day bucket
// (timeSpentOnDay, what the worklog sums) can be corrected. update_task { time_spent: 0 }
// only zeroed the total; the daily bucket survived and add_time_today rejects negatives,
// so there was no way to fix an over-accrued day.

describe('mergeTimeSpentOnDay', () => {
  it('merges a patch into the existing bucket and recomputes the total', () => {
    const res = mergeTimeSpentOnDay({ '2026-08-05': 129535 }, { '2026-08-05': 0, '2026-08-06': 60000 }, undefined);
    expect(res).toEqual({
      timeSpentOnDay: { '2026-08-05': 0, '2026-08-06': 60000 },
      timeSpent: 60000,
    });
  });

  it('leaves dates not listed in the patch untouched', () => {
    const res = mergeTimeSpentOnDay({ '2026-08-01': 1000, '2026-08-02': 2000 }, { '2026-08-02': 500 }, undefined);
    expect(res).toEqual({
      timeSpentOnDay: { '2026-08-01': 1000, '2026-08-02': 500 },
      timeSpent: 1500,
    });
  });

  it('handles an empty existing bucket', () => {
    const res = mergeTimeSpentOnDay(undefined, { '2026-08-05': 123 }, undefined);
    expect(res).toEqual({ timeSpentOnDay: { '2026-08-05': 123 }, timeSpent: 123 });
  });

  it('respects an explicit total when the caller sets time_spent too', () => {
    const res = mergeTimeSpentOnDay({ '2026-08-05': 100 }, { '2026-08-05': 0 }, 999);
    expect(res.timeSpent).toBe(999);
    expect(res.timeSpentOnDay).toEqual({ '2026-08-05': 0 });
  });

  it('returns null for negative or non-numeric values', () => {
    expect(mergeTimeSpentOnDay({}, { '2026-08-05': -1 }, undefined)).toBeNull();
    expect(mergeTimeSpentOnDay({}, { '2026-08-05': '50' }, undefined)).toBeNull();
    expect(mergeTimeSpentOnDay({}, null, undefined)).toBeNull();
  });
});
