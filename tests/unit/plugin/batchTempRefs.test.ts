import { describe, it, expect, vi } from 'vitest';
import { runBatchUpdateForProject, rewriteBatchOp } from '../../../plugin/plugin.js';

// Regression: SP 18.16's plugin bridge loses same-batch temp_id references
// (create parent_id = temp_id silently drops the task; reorder with temp ids no-ops),
// so the plugin resolves temp refs itself before dispatching to SP.
// Verified live 2026-08-05: real-id create/reorder/update/delete all work, temp refs don't.

function makeApi(results) {
  let i = 0;
  const calls = [];
  const api = {
    batchUpdateForProject: vi.fn(async (data) => {
      calls.push(data.operations);
      return results[Math.min(i++, results.length - 1)];
    }),
  };
  return { api, calls };
}

describe('rewriteBatchOp', () => {
  const tempToReal = { A: 'idA', B: 'idB' };
  const declared = ['A', 'B'];

  it('resolves create parent_id temp refs', () => {
    expect(rewriteBatchOp({ type: 'create', tempId: 'C', data: { title: 'x', parentId: 'A' } }, tempToReal, declared))
      .toEqual({ type: 'create', tempId: 'C', data: { title: 'x', parentId: 'idA' } });
  });

  it('resolves reorder task_ids and update taskId/parentId/subTaskIds and delete taskId', () => {
    expect(rewriteBatchOp({ type: 'reorder', taskIds: ['A', 'x'] }, tempToReal, declared))
      .toEqual({ type: 'reorder', taskIds: ['idA', 'x'] });
    expect(rewriteBatchOp({ type: 'update', taskId: 'A', updates: { parentId: 'B', subTaskIds: ['A', 'z'] } }, tempToReal, declared))
      .toEqual({ type: 'update', taskId: 'idA', updates: { parentId: 'idB', subTaskIds: ['idA', 'z'] } });
    expect(rewriteBatchOp({ type: 'delete', taskId: 'B' }, tempToReal, declared))
      .toEqual({ type: 'delete', taskId: 'idB' });
  });

  it('passes non-temp ids and unknown ids through untouched', () => {
    expect(rewriteBatchOp({ type: 'create', tempId: 'C', data: { title: 'x', parentId: 'real1' } }, tempToReal, declared))
      .toEqual({ type: 'create', tempId: 'C', data: { title: 'x', parentId: 'real1' } });
    expect(rewriteBatchOp({ type: 'reorder', taskIds: ['unknown', 'real2'] }, tempToReal, declared))
      .toEqual({ type: 'reorder', taskIds: ['unknown', 'real2'] });
  });
});

describe('runBatchUpdateForProject', () => {
  it('sends a single call with the original ops when there are no temp refs', async () => {
    const ops = [{ type: 'create', tempId: 'A', data: { title: 'x' } }];
    const { api, calls } = makeApi([{ success: true, createdTaskIds: { A: 'idA' }, errors: [] }]);
    const out = await runBatchUpdateForProject(api, { projectId: 'P', operations: ops });
    expect(api.batchUpdateForProject).toHaveBeenCalledTimes(1);
    expect(calls[0]).toEqual(ops);
    expect(out).toEqual({ success: true, createdTaskIds: { A: 'idA' }, errors: [] });
  });

  it('resolves a subtask create referencing a same-batch temp parent (two calls)', async () => {
    const ops = [
      { type: 'create', tempId: 'A', data: { title: 'a' } },
      { type: 'create', tempId: 'B', data: { title: 'b', parentId: 'A' } },
    ];
    const { api, calls } = makeApi([
      { success: true, createdTaskIds: { A: 'idA' }, errors: [] },
      { success: true, createdTaskIds: { B: 'idB' }, errors: [] },
    ]);
    const out = await runBatchUpdateForProject(api, { projectId: 'P', operations: ops });
    expect(api.batchUpdateForProject).toHaveBeenCalledTimes(2);
    expect(calls[0]).toEqual([ops[0]]);
    expect(calls[1]).toEqual([{ type: 'create', tempId: 'B', data: { title: 'b', parentId: 'idA' } }]);
    expect(out.createdTaskIds).toEqual({ A: 'idA', B: 'idB' });
  });

  it('rewrites reorder/update/delete refs into a final call with real ids', async () => {
    const ops = [
      { type: 'create', tempId: 'A', data: { title: 'a' } },
      { type: 'create', tempId: 'B', data: { title: 'b' } },
      { type: 'reorder', taskIds: ['B', 'A'] },
      { type: 'update', taskId: 'A', updates: { title: 'renamed' } },
      { type: 'delete', taskId: 'B' },
    ];
    const { api, calls } = makeApi([
      { success: true, createdTaskIds: { A: 'idA', B: 'idB' }, errors: [] },
      { success: true, createdTaskIds: {}, errors: [] },
    ]);
    await runBatchUpdateForProject(api, { projectId: 'P', operations: ops });
    expect(api.batchUpdateForProject).toHaveBeenCalledTimes(2);
    expect(calls[1]).toEqual([
      { type: 'reorder', taskIds: ['idB', 'idA'] },
      { type: 'update', taskId: 'idA', updates: { title: 'renamed' } },
      { type: 'delete', taskId: 'idB' },
    ]);
  });

  it('handles multi-level parent chains in successive passes', async () => {
    const ops = [
      { type: 'create', tempId: 'A', data: { title: 'a' } },
      { type: 'create', tempId: 'B', data: { title: 'b', parentId: 'A' } },
      { type: 'create', tempId: 'C', data: { title: 'c', parentId: 'B' } },
    ];
    const { api, calls } = makeApi([
      { success: true, createdTaskIds: { A: 'idA' }, errors: [] },
      { success: true, createdTaskIds: { B: 'idB' }, errors: [] },
      { success: true, createdTaskIds: { C: 'idC' }, errors: [] },
    ]);
    const out = await runBatchUpdateForProject(api, { projectId: 'P', operations: ops });
    expect(api.batchUpdateForProject).toHaveBeenCalledTimes(3);
    expect(calls[0]).toEqual([ops[0]]);
    expect(calls[1]).toEqual([{ type: 'create', tempId: 'B', data: { title: 'b', parentId: 'idA' } }]);
    expect(calls[2]).toEqual([{ type: 'create', tempId: 'C', data: { title: 'c', parentId: 'idB' } }]);
    expect(out.errors).toEqual([]);
  });

  it('surfaces unresolvable temp parents (cycle) instead of looping forever', async () => {
    const ops = [
      { type: 'create', tempId: 'A', data: { title: 'a', parentId: 'B' } },
      { type: 'create', tempId: 'B', data: { title: 'b', parentId: 'A' } },
    ];
    const { api } = makeApi([{ success: true, createdTaskIds: {}, errors: [] }]);
    const out = await runBatchUpdateForProject(api, { projectId: 'P', operations: ops });
    expect(out.errors.length).toBe(2);
    expect(out.errors.every((e) => e.error.includes('Unresolvable temp parent_id'))).toBe(true);
  });

  it('merges errors and success flags from all passes', async () => {
    const ops = [
      { type: 'create', tempId: 'A', data: { title: 'a' } },
      { type: 'create', tempId: 'B', data: { title: 'b', parentId: 'A' } },
    ];
    const { api } = makeApi([
      { success: true, createdTaskIds: { A: 'idA' }, errors: [{ op: 'create', tempId: 'X', error: 'boom' }] },
      { success: false, createdTaskIds: {}, errors: [{ op: 'update', taskId: 'idA', error: 'nope' }] },
    ]);
    const out = await runBatchUpdateForProject(api, { projectId: 'P', operations: ops });
    expect(out.success).toBe(false);
    expect(out.errors).toHaveLength(2);
  });
});
