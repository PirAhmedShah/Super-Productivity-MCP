import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { sendCommand } from '../ipc/command-sender.js';
import type { ResolvedDirs } from '../ipc/directories.js';
import { enrichTask, loadRefs } from '../enrich.js';
import { errorResult, okResult } from './result.js';

// Work-context and UI-selection tools backed by SP 18.16 plugin API:
// getActiveWorkContext, getCurrentContextTasks, getSelectedTask, getFocusedTask, selectTask.

export function registerContextTools(server: McpServer, dirs: ResolvedDirs): void {
  server.registerTool(
    'get_active_work_context',
    {
      description:
        'Return the currently active work context in Super Productivity: the project or tag the user is viewing, or TODAY. Reports { id, type: "PROJECT"|"TAG"|"TODAY", title, taskIds }. Resolves to null only before the app finishes its initial data load.',
      inputSchema: {},
    },
    async () => {
      const res = await sendCommand(dirs, 'getActiveWorkContext', {});
      if (!res.success) return errorResult(res.error ?? 'Failed to get active work context');
      return okResult({ context: res.result ?? null });
    },
  );

  server.registerTool(
    'get_current_context_tasks',
    {
      description:
        'Return the tasks currently rendered in the active work context (project/tag/Today view). Enriched with projectTitle + tags. Useful to know exactly what the user is looking at right now.',
      inputSchema: {},
    },
    async () => {
      const res = await sendCommand(dirs, 'getCurrentContextTasks', {});
      if (!res.success) return errorResult(res.error ?? 'Failed to get current context tasks');
      const tasks = (res.result as Array<Record<string, unknown>>) ?? [];
      const refs = await loadRefs(dirs);
      return okResult({ tasks: tasks.map(t => enrichTask(t, refs)) });
    },
  );

  server.registerTool(
    'get_selected_task',
    {
      description:
        'Return the task currently open in Super Productivity\'s task detail panel, or null when none is selected. Enriched with projectTitle + tags.',
      inputSchema: {},
    },
    async () => {
      const res = await sendCommand(dirs, 'getSelectedTask', {});
      if (!res.success) return errorResult(res.error ?? 'Failed to get selected task');
      const task = res.result as Record<string, unknown> | null;
      if (!task) return okResult({ task: null });
      const refs = await loadRefs(dirs);
      return okResult({ task: enrichTask(task, refs) });
    },
  );

  server.registerTool(
    'get_focused_task',
    {
      description:
        'Return the task row currently focused by the user if any, else null. Focus is transient (cleared when moving focus elsewhere). Enriched with projectTitle + tags.',
      inputSchema: {},
    },
    async () => {
      const res = await sendCommand(dirs, 'getFocusedTask', {});
      if (!res.success) return errorResult(res.error ?? 'Failed to get focused task');
      const task = res.result as Record<string, unknown> | null;
      if (!task) return okResult({ task: null });
      const refs = await loadRefs(dirs);
      return okResult({ task: enrichTask(task, refs) });
    },
  );

  server.registerTool(
    'select_task',
    {
      description:
        'Open a task (or subtask) in Super Productivity\'s task detail panel. Works regardless of the active view.',
      inputSchema: {
        task_id: z.string().describe('Task or subtask ID to select'),
      },
    },
    async ({ task_id }) => {
      if (!task_id?.trim()) return errorResult('task_id is required');
      const res = await sendCommand(dirs, 'selectTask', { taskId: task_id });
      if (!res.success) return errorResult(res.error ?? 'Failed to select task');
      return okResult({ success: true, taskId: task_id });
    },
  );
}