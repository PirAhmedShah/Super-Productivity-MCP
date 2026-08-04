import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { sendCommand } from '../ipc/command-sender.js';
import type { ResolvedDirs } from '../ipc/directories.js';
import { errorResult, okResult } from './result.js';

// SP 18.16+ batchUpdateForProject — atomic multi-op writes for one project.
// Snake_case agent-facing schema maps onto SP's BatchOperation shape.

const batchCreateSchema = z.object({
  type: z.literal('create'),
  temp_id: z.string().describe('Temporary ID of your choice; later operations reference it (as parent_id or in reorder task_ids)'),
  data: z.object({
    title: z.string().describe('Task title'),
    notes: z.string().optional(),
    is_done: z.boolean().optional(),
    parent_id: z.string().nullable().optional().describe('Parent task ID or a temp_id from another create op'),
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
    sub_task_ids: z.array(z.string()).optional(),
  }),
});

const batchDeleteSchema = z.object({
  type: z.literal('delete'),
  task_id: z.string().describe('REAL task ID to delete (temp_ids of same-batch creates are silently skipped by SP; use the id from createdTaskIds in a follow-up call)'),
});

const batchReorderSchema = z.object({
  type: z.literal('reorder'),
  task_ids: z.array(z.string()).describe('Complete ordered list of task IDs (may include temp_ids of created tasks)'),
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
      if (op.updates.sub_task_ids !== undefined) u.subTaskIds = op.updates.sub_task_ids;
      return { type: 'update', taskId: op.task_id, updates: u };
    }
    case 'delete':
      return { type: 'delete', taskId: op.task_id };
    case 'reorder':
      return { type: 'reorder', taskIds: op.task_ids };
  }
}

export function registerBatchTools(server: McpServer, dirs: ResolvedDirs): void {
  server.registerTool(
    'batch_update_project',
    {
      description:
        'Apply atomic multi-operation changes to one project in Super Productivity in a single transaction (create/update/delete/reorder). Unlike bulk_update_tasks (plain per-task updates), this supports references: give new tasks a temp_id and later ops in the SAME call may use it as parent_id or inside reorder task_ids / sub_task_ids. IMPORTANT (SP limitation): update and delete ops only resolve REAL task IDs — to update/delete a task you just created in this batch, run a second call and pass its id from this call\'s createdTaskIds. On partial failure SP drops skipped ops silently (logged server-side), so verify the result.',
      inputSchema: {
        project_id: z.string().describe('Project ID to apply the operations to'),
        operations: z.array(batchOperationSchema).min(1).describe('Operations to apply, in order. temp_id/tempIds resolve only for create-parent/reorder/subTaskIds; update/delete need real ids (two-phase pattern).'),
      },
    },
    async ({ project_id, operations }) => {
      if (!project_id?.trim()) return errorResult('project_id is required');
      const res = await sendCommand(dirs, 'batchUpdateForProject', {
        data: { projectId: project_id, operations: operations.map(toSpOperation) },
      });
      if (!res.success) return errorResult(res.error ?? 'Failed to apply batch');
      const r = (res.result ?? {}) as { success?: boolean; createdTaskIds?: Record<string, string>; errors?: unknown[] };
      return okResult({
        success: r.success ?? true,
        createdTaskIds: r.createdTaskIds ?? {},
        errors: r.errors ?? [],
      });
    },
  );
}