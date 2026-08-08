import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { sendCommand } from '../ipc/command-sender.js';
import type { ResolvedDirs } from '../ipc/directories.js';
import { errorResult, okResult } from './result.js';
import { minuteFloor } from './time.js';
import { fetchTasksByIds, rezeroUnplannedParents } from './tasks.js';

// SP 18.16+ batchUpdateForProject — atomic multi-op writes for one project.
// Snake_case agent-facing schema maps onto SP's BatchOperation shape.

const batchCreateSchema = z.object({
  type: z.literal('create'),
  temp_id: z.string().describe('Temporary ID of your choice; echoed back in createdTaskIds. Same-batch temp ids resolve for parent_id/reorder (plugin >= 1.7.1 resolves them itself; stale plugins silently drop them — then use the two-phase pattern)'),
  data: z.object({
    title: z.string().describe('Task title'),
    notes: z.string().optional(),
    is_done: z.boolean().optional(),
    parent_id: z.string().nullable().optional().describe('Parent task ID, or a temp_id from a create op in the same batch (resolved plugin-side, plugin >= 1.7.1). On a stale plugin a same-batch temp parent_id silently drops the subtask — then create the parent first and use its real id'),
    time_estimate: z.number().int().nonnegative().optional().describe('Time estimate in ms'),
  }),
});

const batchUpdateSchema = z.object({
  type: z.literal('update'),
  task_id: z.string().describe('REAL task ID to update (temp_ids of same-batch creates are silently skipped by SP; use the id from createdTaskIds in a follow-up call)'),
  updates: z.object({
    title: z.string().optional(),
    notes: z.string().optional(),
    is_done: z.boolean().optional(),
    parent_id: z.string().nullable().optional(),
    time_estimate: z.number().int().nonnegative().optional(),
    due_with_time: z.number().nullable().optional().describe('Unix ms timestamp to plan the task at an exact time (maps to SP dueWithTime). Floored to the whole minute on write — 1 minute is the smallest scheduling unit. Pass null to unplan.'),
    sub_task_ids: z.array(z.string()).optional(),
  }),
});

const batchDeleteSchema = z.object({
  type: z.literal('delete'),
  task_id: z.string().describe('REAL task ID to delete (temp_ids of same-batch creates are silently skipped by SP; use the id from createdTaskIds in a follow-up call)'),
});

const batchReorderSchema = z.object({
  type: z.literal('reorder'),
  task_ids: z.array(z.string()).describe('Complete ordered list of task IDs (may include temp_ids of same-batch creates — resolved plugin-side, plugin >= 1.7.1; stale plugins no-op on temp ids)'),
});

const batchOperationSchema = z.discriminatedUnion('type', [
  batchCreateSchema,
  batchUpdateSchema,
  batchDeleteSchema,
  batchReorderSchema,
]);

export type BatchOperation = z.infer<typeof batchOperationSchema>;

/** Map snake_case agent ops onto SP's BatchOperation shape. Exported for testability. */
export function toSpOperation(op: BatchOperation): Record<string, unknown> {
  switch (op.type) {
    case 'create': {
      const d: Record<string, unknown> = { title: op.data.title };
      if (op.data.notes !== undefined) d.notes = op.data.notes;
      if (op.data.is_done !== undefined) d.isDone = op.data.is_done;
      if (op.data.parent_id !== undefined) d.parentId = op.data.parent_id;
      if (op.data.time_estimate !== undefined) d.timeEstimate = op.data.time_estimate;
      return { type: 'create', tempId: op.temp_id, data: d };
    }
    case 'update': {
      const u: Record<string, unknown> = {};
      if (op.updates.title !== undefined) u.title = op.updates.title;
      if (op.updates.notes !== undefined) u.notes = op.updates.notes;
      if (op.updates.is_done !== undefined) u.isDone = op.updates.is_done;
      if (op.updates.parent_id !== undefined) u.parentId = op.updates.parent_id;
      if (op.updates.time_estimate !== undefined) u.timeEstimate = op.updates.time_estimate;
      // NOTE: due_with_time is deliberately NOT mapped into the SP batch payload —
      // SP's batch reducer silently drops dueWithTime on update ops (see issue #14).
      // Planned times are applied via a bulkUpdateTasks follow-up instead.
      if (op.updates.sub_task_ids !== undefined) u.subTaskIds = op.updates.sub_task_ids;
      return { type: 'update', taskId: op.task_id, updates: u };
    }
    case 'delete':
      return { type: 'delete', taskId: op.task_id };
    case 'reorder':
      return { type: 'reorder', taskIds: op.task_ids };
  }
}

/**
 * Split planned-time updates out of the batch (SP's batch reducer drops
 * dueWithTime silently). Values are floored to the whole minute; null = unplan.
 * Exported for testability.
 */
export function extractPlannedTimeUpdates(operations: BatchOperation[]): { taskId: string; dueWithTime: number | null }[] {
  const out: { taskId: string; dueWithTime: number | null }[] = [];
  for (const op of operations) {
    if (op.type !== 'update') continue;
    const dt = op.updates.due_with_time;
    if (dt === undefined) continue;
    out.push({ taskId: op.task_id, dueWithTime: dt === null ? null : minuteFloor(dt) });
  }
  return out;
}

export function registerBatchTools(server: McpServer, dirs: ResolvedDirs): void {
  server.registerTool(
    'batch_update_project',
    {
      description:
        'Apply atomic multi-operation changes to one project in Super Productivity in a single transaction (create/update/delete/reorder). Unlike bulk_update_tasks (plain per-task updates), this supports references: give new tasks a temp_id and later ops in the SAME call may use it as parent_id, inside reorder task_ids, or in sub_task_ids (plugin >= 1.7.1 resolves temp ids itself before dispatching). update and delete ops still need REAL task IDs — to update/delete a task you just created in this batch, run a second call with its id from this call\'s createdTaskIds (two-phase). Known issue: a stale plugin (< 1.7.1) silently drops same-batch temp references — same-batch create-with-temp-parent_id fails to persist and temp-id reorders no-op. On partial failure SP drops skipped ops silently (logged server-side), so verify the result.',
      inputSchema: {
        project_id: z.string().describe('Project ID to apply the operations to'),
        operations: z.array(batchOperationSchema).min(1).describe('Operations to apply, in order. temp_id/tempIds resolve for create-parent/reorder/subTaskIds (plugin >= 1.7.1); update/delete need real ids (two-phase pattern).'),
      },
    },
    async ({ project_id, operations }) => {
      if (!project_id?.trim()) return errorResult('project_id is required');
      const planned = extractPlannedTimeUpdates(operations);
      const res = await sendCommand(dirs, 'batchUpdateForProject', {
        data: { projectId: project_id, operations: operations.map(toSpOperation) },
      });
      if (!res.success) return errorResult(res.error ?? 'Failed to apply batch');
      const r = (res.result ?? {}) as { success?: boolean; createdTaskIds?: Record<string, string>; errors?: unknown[] };
      const errors = [...((r.errors ?? []) as unknown[])];
      let plannedTimeApplied = 0;
      if (planned.length > 0) {
        try {
          const followUp = await sendCommand(dirs, 'bulkUpdateTasks', {
            updates: planned.map(p => ({ taskId: p.taskId, data: { dueWithTime: p.dueWithTime } })),
          });
          if (!followUp.success) throw new Error(followUp.error ?? 'unknown error');
          plannedTimeApplied = planned.length;
        } catch (e) {
          errors.push(`planned-time follow-up failed: ${(e as Error).message}`);
        }
      }
      const touchedRealIds = operations.filter(o => o.type === 'update').map(o => o.task_id);
      const rezeroed = await rezeroUnplannedParents(dirs, touchedRealIds);
      const tasks = await fetchTasksByIds(dirs, [...touchedRealIds, ...rezeroed]);
      return okResult({
        success: r.success ?? true,
        createdTaskIds: r.createdTaskIds ?? {},
        errors,
        plannedTimeApplied,
        rezeroedParentIds: rezeroed.length > 0 ? rezeroed : null,
        tasks,
      });
    },
  );
}