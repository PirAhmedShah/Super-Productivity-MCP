import { describe, it, expect } from 'vitest';
import { deriveSchedule, findOverlaps, isContainer, localDateStr, plannedTimeOf } from '../../../src/tools/schedule.js';

const HOUR = 3_600_000;
// Local 2026-08-04 09:00
const NINE_AM = new Date(2026, 7, 4, 9, 0).getTime();
const NOW = NINE_AM + 30 * 60 * 1000; // 09:30

function task(overrides: Record<string, unknown> = {}) {
  return {
    id: 't1',
    title: 'Task',
    isDone: false,
    projectId: null,
    tagIds: [],
    dueDay: null,
    dueWithTime: NINE_AM,
    timeEstimate: HOUR,
    doneOn: null,
    ...overrides,
  };
}

describe('localDateStr / plannedTimeOf (moved helpers)', () => {
  it('formats local date', () => {
    expect(localDateStr(new Date(2026, 7, 4, 0, 5))).toBe('2026-08-04');
  });

  it('reads dueWithTime as the effective planned time', () => {
    expect(plannedTimeOf(task({ dueWithTime: NINE_AM }))).toBe(NINE_AM);
    expect(plannedTimeOf(task({ dueWithTime: null }))).toBeNull();
    expect(plannedTimeOf({ id: 'x' } as any)).toBeNull();
  });
});

describe('isContainer', () => {
  it('detects parents with subtasks as containers', () => {
    expect(isContainer(task({ subTaskIds: ['c1', 'c2'] }))).toBe(true);
  });

  it('is false for leaves, missing/empty subTaskIds', () => {
    expect(isContainer(task({ subTaskIds: [] }))).toBe(false);
    expect(isContainer(task({ subTaskIds: undefined }))).toBe(false);
    expect(isContainer(task())).toBe(false);
  });
});

describe('deriveSchedule', () => {
  it('computes start/end/duration from planned time and estimate', () => {
    const s = deriveSchedule(task(), NOW);
    expect(s.startMs).toBe(NINE_AM);
    expect(s.endMs).toBe(NINE_AM + HOUR);
    expect(s.startTime).toBe('09:00');
    expect(s.endTime).toBe('10:00');
    expect(s.durationMs).toBe(HOUR);
    expect(s.hasDuration).toBe(true);
  });

  it('marks status upcoming when now is before start', () => {
    expect(deriveSchedule(task(), NINE_AM - 1000).status).toBe('upcoming');
  });

  it('marks status in-progress when now is within [start, end)', () => {
    expect(deriveSchedule(task(), NOW).status).toBe('in-progress');
  });

  it('marks status past when now is at/after end', () => {
    expect(deriveSchedule(task(), NINE_AM + HOUR + 1).status).toBe('past');
    expect(deriveSchedule(task(), NINE_AM + HOUR).status).toBe('past');
  });

  it('marks status done for completed tasks', () => {
    expect(deriveSchedule(task({ isDone: true }), NOW).status).toBe('done');
  });

  it('marks status unsized when there is no planned time', () => {
    const s = deriveSchedule(task({ dueWithTime: null }), NOW);
    expect(s.status).toBe('unsized');
    expect(s.startMs).toBeNull();
    expect(s.endMs).toBeNull();
  });

  it('leaves end null when estimate is absent or zero (unknown duration)', () => {
    const zero = deriveSchedule(task({ timeEstimate: 0 }), NOW);
    expect(zero.hasDuration).toBe(false);
    expect(zero.endMs).toBeNull();
    expect(zero.endTime).toBeNull();
    expect(zero.status).toBe('in-progress'); // started, unbounded
  });

  it('containers never carry a duration even with a mutated (aggregated) estimate', () => {
    // SP core re-aggregates parent timeEstimate = sum of children (bug
    // sp-parent-estimate-auto-aggregated); containers must still be unsized.
    const s = deriveSchedule(task({ subTaskIds: ['c1'], timeEstimate: 2_400_000 }), NOW);
    expect(s.hasDuration).toBe(false);
    expect(s.endMs).toBeNull();
    expect(s.endTime).toBeNull();
    expect(s.durationMs).toBeNull();
  });

  it('planned containers report a start but no duration', () => {
    const s = deriveSchedule(task({ subTaskIds: ['c1'], timeEstimate: 2_400_000 }), NOW);
    expect(s.startMs).toBe(NINE_AM);
    expect(s.startTime).toBe('09:00');
    expect(s.status).toBe('in-progress');
  });
});

describe('findOverlaps', () => {
  const item = (id: string, startMs: number | null, endMs: number | null) => ({ taskId: id, startMs, endMs });

  it('returns empty when nothing overlaps', () => {
    expect(findOverlaps([
      item('a', NINE_AM, NINE_AM + HOUR),
      item('b', NINE_AM + HOUR, NINE_AM + 2 * HOUR),
    ])).toEqual([]);
  });

  it('treats boundary touch as NOT an overlap', () => {
    expect(findOverlaps([
      item('a', NINE_AM, NINE_AM + HOUR),
      item('b', NINE_AM + HOUR, NINE_AM + 2 * HOUR),
    ])).toEqual([]);
  });

  it('reports a single overlapping pair with its busy window', () => {
    const clusters = findOverlaps([
      item('a', NINE_AM, NINE_AM + HOUR),
      item('b', NINE_AM + 30 * 60 * 1000, NINE_AM + 2 * HOUR),
    ]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].taskIds).toEqual(['a', 'b']);
    expect(clusters[0].count).toBe(2);
    expect(clusters[0].fromMs).toBe(NINE_AM);
    expect(clusters[0].toMs).toBe(NINE_AM + 2 * HOUR);
    expect(clusters[0].fromTime).toBe('09:00');
    expect(clusters[0].toTime).toBe('11:00');
  });

  it('merges transitively-connected tasks into one cluster', () => {
    const clusters = findOverlaps([
      item('a', NINE_AM, NINE_AM + HOUR),
      item('b', NINE_AM + 30 * 60 * 1000, NINE_AM + 40 * 60 * 1000),
      item('c', NINE_AM + 35 * 60 * 1000, NINE_AM + 90 * 60 * 1000),
    ]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].taskIds).toEqual(['a', 'b', 'c']);
    expect(clusters[0].count).toBe(3);
  });

  it('a long interval bridges: task touching the cluster edge still joins via a real overlap', () => {
    // c[10:00-10:30] touches a's end (10:00) but genuinely overlaps the long b[9:30-10:45] —
    // the bridge must include c, not split the cluster at the touch point.
    const clusters = findOverlaps([
      item('a', NINE_AM, NINE_AM + HOUR),
      item('b', NINE_AM + 30 * 60 * 1000, NINE_AM + 105 * 60 * 1000),
      item('c', NINE_AM + HOUR, NINE_AM + 90 * 60 * 1000),
    ]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].taskIds).toEqual(['a', 'b', 'c']);
    expect(clusters[0].toMs).toBe(NINE_AM + 105 * 60 * 1000);
  });

  it('splits disjoint clusters into separate groups', () => {
    const clusters = findOverlaps([
      item('a', NINE_AM, NINE_AM + HOUR),
      item('b', NINE_AM + 10 * 60 * 1000, NINE_AM + 20 * 60 * 1000),
      item('c', NINE_AM + 3 * HOUR, NINE_AM + 4 * HOUR),
      item('d', NINE_AM + 3 * HOUR + 30 * 60 * 1000, NINE_AM + 5 * HOUR),
    ]);
    expect(clusters).toHaveLength(2);
    expect(clusters[0].taskIds).toEqual(['a', 'b']);
    expect(clusters[1].taskIds).toEqual(['c', 'd']);
  });

  it('excludes tasks without a start or end (unsized)', () => {
    const clusters = findOverlaps([
      item('a', NINE_AM, NINE_AM + HOUR),
      item('b', null, null),
      item('c', NINE_AM + 10 * 60 * 1000, NINE_AM + 20 * 60 * 1000),
    ]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].taskIds).toEqual(['a', 'c']);
  });
});
