import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { sendCommand } from '../ipc/command-sender.js';
import type { ResolvedDirs } from '../ipc/directories.js';
import { errorResult, okResult } from './result.js';

// Full app-state snapshot, notes, and lifecycle tools backed by SP 18.16 plugin API.

export function registerStateTools(server: McpServer, dirs: ResolvedDirs): void {
  server.registerTool(
    'get_app_state',
    {
      description:
        'Return a complete read-only snapshot of Super Productivity state: tasks, projects, tags, notes, task repeat configs, simple counters and (credential-free) global config — the same data SP\'s "Export data" would write. Optionally also persist it as a JSON file by passing output_path.',
      inputSchema: {
        output_path: z.string().optional().describe('Optional absolute file path to write the snapshot JSON to (e.g. a backup file). Parent dirs are created.'),
      },
    },
    async ({ output_path }) => {
      const res = await sendCommand(dirs, 'getAppState', {});
      if (!res.success) return errorResult(res.error ?? 'Failed to get app state');
      const state = res.result ?? null;
      let savedTo: string | null = null;
      if (output_path) {
        try {
          mkdirSync(dirname(output_path), { recursive: true });
          writeFileSync(output_path, JSON.stringify(state, null, 2), 'utf-8');
          savedTo = output_path;
        } catch (e) {
          return errorResult(`Failed to write snapshot to ${output_path}: ${(e as Error).message}`);
        }
      }
      return okResult({ state, savedTo });
    },
  );

  server.registerTool(
    'get_notes',
    {
      description: 'Return all notes from Super Productivity (id, projectId, content, pinned-to-today, timestamps).',
      inputSchema: {},
    },
    async () => {
      const res = await sendCommand(dirs, 'getNotes', {});
      if (!res.success) return errorResult(res.error ?? 'Failed to get notes');
      return okResult({ notes: (res.result as unknown[] | null) ?? [] });
    },
  );

  server.registerTool(
    'reinit_data',
    {
      description:
        'Tell Super Productivity to reload its persisted data from disk/storage (e.g. after agent-side file changes). Returns success once the reload initiated.',
      inputSchema: {},
    },
    async () => {
      const res = await sendCommand(dirs, 'reInitData', {});
      if (!res.success) return errorResult(res.error ?? 'Failed to re-init data');
      return okResult({ success: true });
    },
  );

  server.registerTool(
    'get_plugin_config',
    {
      description: 'Return this MCP plugin\'s optional configuration (null unless a config handler is registered in the plugin).',
      inputSchema: {},
    },
    async () => {
      const res = await sendCommand(dirs, 'getConfig', {});
      if (!res.success) return errorResult(res.error ?? 'Failed to get plugin config');
      return okResult({ config: res.result ?? null });
    },
  );
}