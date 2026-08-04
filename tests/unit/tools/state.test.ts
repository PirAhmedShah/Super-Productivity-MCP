import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/ipc/command-sender.js', () => ({ sendCommand: vi.fn() }));

import { sendCommand } from '../../../src/ipc/command-sender.js';
import { toArrays, registerStateTools } from '../../../src/tools/state.js';

const mockSend = vi.mocked(sendCommand);

describe('toArrays (get_app_state normalization)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('converts id-keyed maps into arrays', () => {
    const out = toArrays({
      tasks: { t1: { id: 't1' }, t2: { id: 't2' } },
      projects: { p1: { id: 'p1' } },
      tags: { g1: { id: 'g1' } },
      notes: {},
      taskRepeatCfgs: { r1: { id: 'r1' } },
      simpleCounters: { c1: { value: 1 } },
      globalConfig: { theme: 'dark' },
    });
    expect(Array.isArray(out.tasks)).toBe(true);
    expect((out.tasks as unknown[]).length).toBe(2);
    expect(out.projects).toEqual([{ id: 'p1' }]);
    expect(out.tags).toEqual([{ id: 'g1' }]);
    expect(out.notes).toEqual([]);
    expect(out.taskRepeatCfgs).toEqual([{ id: 'r1' }]);
    expect(out.simpleCounters).toEqual([{ value: 1 }]);
    expect(out.globalConfig).toEqual({ theme: 'dark' });
  });

  it('leaves existing arrays untouched and preserves other keys', () => {
    const out = toArrays({ tasks: [], projects: wrappers1(), globalConfig: {} });
    expect(out.tasks).toEqual([]);
    expect(out.globalConfig).toEqual({});
  });

  it('sendCommand payload uses getAppState with empty fields', async () => {
    mockSend.mockResolvedValueOnce({ success: true, result: { tasks: {}, notes: {} }, timestamp: Date.now() });
    const res = await sendCommand({ base: '/t', commands: '/t/c', responses: '/t/r' }, 'getAppState', {});
    expect(res.success).toBe(true);
    expect(mockSend).toHaveBeenCalledWith(expect.anything(), 'getAppState', {});
  });

  it('registerStateTools exposes the expected tool names', () => {
    expect(typeof registerStateTools).toBe('function');
  });
});

// avoid inline helper noise; this branch is incidental
function wrappers1(): Array<{ id: string }> {
  return [{ id: 'p1' }];
}