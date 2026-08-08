import { describe, it, expect } from 'vitest';
import { extractPlannedTimeUpdates, toSpOperation } from '../../../src/tools/batch.js';

describe('toSpOperation mapping (batch_update_project)', () => {
  it('maps a create op with only a title', () => {
    expect(toSpOperation({ type: 'create', temp_id: 't1', data: { title: 'New task' } })).toEqual({
      type: 'create',
      tempId: 't1',
      data: { title: 'New task' },
    });
  });

  it('maps a create op with all options, renaming fields to SP camelCase', () => {
    expect(toSpOperation({
      type: 'create',
      temp_id: 't1',
      data: { title: 'A', notes: 'n', is_done: true, parent_id: 't2', time_estimate: 1800000 },
    })).toEqual({
      type: 'create',
      tempId: 't1',
      data: { title: 'A', notes: 'n', isDone: true, parentId: 't2', timeEstimate: 1800000 },
    });
  });

  it('omits optional create fields that are absent', () => {
    const op = toSpOperation({ type: 'create', temp_id: 't1', data: { title: 'A' } }) as { data: Record<string, unknown> };
    expect(op.data).toEqual({ title: 'A' });
    expect(op.data).not.toHaveProperty('notes');
    expect(op.data).not.toHaveProperty('isDone');
  });

  it('maps an update op (sub_task_ids -> subTaskIds)', () => {
    expect(toSpOperation({
      type: 'update',
      task_id: 'real-1',
      updates: { title: 'B', is_done: true, sub_task_ids: ['s1', 's2'] },
    })).toEqual({
      type: 'update',
      taskId: 'real-1',
      updates: { title: 'B', isDone: true, subTaskIds: ['s1', 's2'] },
    });
  });

  it('NEVER maps due_with_time into the SP payload (SP batch update ops silently drop it — #14)', () => {
    const op = toSpOperation({
      type: 'update',
      task_id: 'real-1',
      updates: { title: 'B', due_with_time: 1785925800000 },
    }) as { updates: Record<string, unknown> };
    expect(op).toEqual({
      type: 'update',
      taskId: 'real-1',
      updates: { title: 'B' },
    });
    expect(op.updates).not.toHaveProperty('dueWithTime');
  });

  it('maps a delete op', () => {
    expect(toSpOperation({ type: 'delete', task_id: 'real-3' })).toEqual({
      type: 'delete',
      taskId: 'real-3',
    });
  });

  it('maps a reorder op (task_ids -> taskIds)', () => {
    expect(toSpOperation({ type: 'reorder', task_ids: ['t1', 'real-1'] })).toEqual({
      type: 'reorder',
      taskIds: ['t1', 'real-1'],
    });
  });
});

describe('extractPlannedTimeUpdates (batch_update_project follow-up split)', () => {
  it('extracts due_with_time from update ops, floored to the whole minute', () => {
    expect(extractPlannedTimeUpdates([
      { type: 'update', task_id: 'real-1', updates: { due_with_time: 1785925818183 } },
    ])).toEqual([{ taskId: 'real-1', dueWithTime: 1785925800000 }]);
  });

  it('passes null through as an unplan (not floored)', () => {
    expect(extractPlannedTimeUpdates([
      { type: 'update', task_id: 'real-1', updates: { due_with_time: null } },
    ])).toEqual([{ taskId: 'real-1', dueWithTime: null }]);
  });

  it('ignores update ops without due_with_time and non-update ops', () => {
    expect(extractPlannedTimeUpdates([
      { type: 'update', task_id: 'real-1', updates: { title: 'B' } },
      { type: 'create', temp_id: 't1', data: { title: 'A' } },
      { type: 'delete', task_id: 'real-2' },
      { type: 'reorder', task_ids: ['t1'] },
    ])).toEqual([]);
  });

  it('extracts multiple ops, preserving order and task ids', () => {
    expect(extractPlannedTimeUpdates([
      { type: 'update', task_id: 'real-1', updates: { due_with_time: 1785925800000 } },
      { type: 'update', task_id: 'real-2', updates: { due_with_time: null } },
    ])).toEqual([
      { taskId: 'real-1', dueWithTime: 1785925800000 },
      { taskId: 'real-2', dueWithTime: null },
    ]);
  });
});