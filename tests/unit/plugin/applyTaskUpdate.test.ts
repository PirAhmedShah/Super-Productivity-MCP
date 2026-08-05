import { describe, it, expect, vi } from 'vitest';
import { applyTaskUpdate } from '../../../plugin/plugin.js';

// Regression: plugin 1.8.1's bulkUpdateTasks was a raw passthrough to PluginAPI.updateTask,
// so bulk could not express time_spent_on_day and mishandled the dueDay/dueWithTime
// interplay. applyTaskUpdate is the shared processor both updateTask and bulkUpdateTasks
// use — identical semantics on both paths.

function makeApi(tasks: any[] = []) {
  const updateTask = vi.fn(async () => ({ success: true }));
  const getTasks = vi.fn(async () => tasks);
  return { api: { getTasks, updateTask }, updateTask, getTasks };
}

describe('applyTaskUpdate', () => {
  it('forwards arbitrary fields untouched', async () => {
    const { api, updateTask } = makeApi();
    await applyTaskUpdate(api, 't1', { title: 'New title', dueWithTime: 123 });
    expect(updateTask).toHaveBeenCalledWith('t1', { title: 'New title', dueWithTime: 123 });
  });

  it('scrubs residual date-like @tokens from titles', async () => {
    const { api, updateTask } = makeApi();
    await applyTaskUpdate(api, 't1', { title: 'Call @tomorrow re invoice' });
    const [id, data] = updateTask.mock.calls[0] as [string, Record<string, unknown>];
    expect(id).toBe('t1');
    expect(data.title).toBe('Call re invoice');
  });

  it('merges time_spent_on_day into the bucket and recomputes timeSpent', async () => {
    const { api, updateTask, getTasks } = makeApi([
      { id: 't1', timeSpentOnDay: { '2026-08-01': 1000 } },
    ]);
    await applyTaskUpdate(api, 't1', { time_spent_on_day: { '2026-08-02': 500 } });
    expect(getTasks).toHaveBeenCalled();
    expect(updateTask).toHaveBeenCalledWith('t1', {
      timeSpentOnDay: { '2026-08-01': 1000, '2026-08-02': 500 },
      timeSpent: 1500,
    });
  });

  it('respects an explicit timeSpent alongside the bucket merge', async () => {
    const { api, updateTask } = makeApi([{ id: 't1', timeSpentOnDay: { '2026-08-01': 1000 } }]);
    await applyTaskUpdate(api, 't1', { time_spent_on_day: { '2026-08-01': 0 }, timeSpent: 999 });
    expect(updateTask).toHaveBeenCalledWith('t1', { timeSpentOnDay: { '2026-08-01': 0 }, timeSpent: 999 });
  });

  it('rejects invalid time_spent_on_day values', async () => {
    const { api } = makeApi([{ id: 't1', timeSpentOnDay: {} }]);
    await expect(applyTaskUpdate(api, 't1', { time_spent_on_day: { '2026-08-01': -5 } }))
      .rejects.toThrow('Invalid time_spent_on_day');
  });

  it('throws Task not found when the task is missing for a bucket merge', async () => {
    const { api } = makeApi([]);
    await expect(applyTaskUpdate(api, 'ghost', { time_spent_on_day: { '2026-08-01': 0 } }))
      .rejects.toThrow('Task not found: ghost');
  });

  it('preserves the existing dueWithTime when only dueDay changes', async () => {
    const { api, updateTask, getTasks } = makeApi([{ id: 't1', dueWithTime: 777 }]);
    await applyTaskUpdate(api, 't1', { dueDay: '2026-09-01' });
    expect(getTasks).toHaveBeenCalled();
    expect(updateTask).toHaveBeenCalledWith('t1', { dueDay: '2026-09-01', dueWithTime: 777 });
  });

  it('lets an explicit dueWithTime (including null) win over the preservation', async () => {
    const { api, updateTask, getTasks } = makeApi([{ id: 't1', dueWithTime: 777 }]);
    await applyTaskUpdate(api, 't1', { dueDay: '2026-09-01', dueWithTime: null });
    expect(getTasks).not.toHaveBeenCalled();
    expect(updateTask).toHaveBeenCalledWith('t1', { dueDay: '2026-09-01', dueWithTime: null });
  });
});
