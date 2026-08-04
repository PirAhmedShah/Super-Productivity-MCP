import { describe, it, expect } from 'vitest';
import { toSpOperation } from '../../../src/tools/batch.js';

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