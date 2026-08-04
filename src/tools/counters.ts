import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { sendCommand } from '../ipc/command-sender.js';
import type { ResolvedDirs } from '../ipc/directories.js';
import { errorResult, okResult } from './result.js';

// Simple counter tools backed by SP 18.16 plugin API (per-plugin counters).
// Counters are keyed by an arbitrary id string of your choosing.

export function registerCounterTools(server: McpServer, dirs: ResolvedDirs): void {
  server.registerTool(
    'get_all_counters',
    {
      description: 'Return all simple counters as { id: value }.',
      inputSchema: {},
    },
    async () => {
      const res = await sendCommand(dirs, 'getAllCounters', {});
      if (!res.success) return errorResult(res.error ?? 'Failed to get counters');
      return okResult({ counters: (res.result as Record<string, number> | null) ?? {} });
    },
  );

  server.registerTool(
    'get_counter',
    {
      description: 'Return the value of one simple counter (null when it does not exist yet).',
      inputSchema: {
        counter_id: z.string().describe('Counter ID'),
      },
    },
    async ({ counter_id }) => {
      if (!counter_id?.trim()) return errorResult('counter_id is required');
      const res = await sendCommand(dirs, 'getCounter', { counterId: counter_id });
      if (!res.success) return errorResult(res.error ?? 'Failed to get counter');
      return okResult({ counterId: counter_id, value: res.result ?? null });
    },
  );

  server.registerTool(
    'set_counter',
    {
      description: 'Set a simple counter to an absolute value (creates it if missing).',
      inputSchema: {
        counter_id: z.string().describe('Counter ID'),
        value: z.number().describe('Value to set'),
      },
    },
    async ({ counter_id, value }) => {
      if (!counter_id?.trim()) return errorResult('counter_id is required');
      if (typeof value !== 'number' || !isFinite(value)) return errorResult('value must be a finite number');
      const res = await sendCommand(dirs, 'setCounter', { counterId: counter_id, value });
      if (!res.success) return errorResult(res.error ?? 'Failed to set counter');
      return okResult({ success: true, counterId: counter_id, value });
    },
  );

  server.registerTool(
    'increment_counter',
    {
      description: 'Increment a simple counter by increment_by (default 1). Creates it as 0 first if missing. Returns the new value.',
      inputSchema: {
        counter_id: z.string().describe('Counter ID'),
        increment_by: z.number().optional().describe('Amount to add (default 1)'),
      },
    },
    async ({ counter_id, increment_by }) => {
      if (!counter_id?.trim()) return errorResult('counter_id is required');
      const res = await sendCommand(dirs, 'incrementCounter', {
        counterId: counter_id,
        ...(increment_by !== undefined ? { incrementBy: increment_by } : {}),
      });
      if (!res.success) return errorResult(res.error ?? 'Failed to increment counter');
      return okResult({ counterId: counter_id, value: res.result ?? null });
    },
  );

  server.registerTool(
    'decrement_counter',
    {
      description: 'Decrement a simple counter by decrement_by (default 1). Creates it as 0 first if missing. Returns the new value.',
      inputSchema: {
        counter_id: z.string().describe('Counter ID'),
        decrement_by: z.number().optional().describe('Amount to subtract (default 1)'),
      },
    },
    async ({ counter_id, decrement_by }) => {
      if (!counter_id?.trim()) return errorResult('counter_id is required');
      const res = await sendCommand(dirs, 'decrementCounter', {
        counterId: counter_id,
        ...(decrement_by !== undefined ? { decrementBy: decrement_by } : {}),
      });
      if (!res.success) return errorResult(res.error ?? 'Failed to decrement counter');
      return okResult({ counterId: counter_id, value: res.result ?? null });
    },
  );

  server.registerTool(
    'delete_counter',
    {
      description: 'Delete a simple counter entirely.',
      inputSchema: {
        counter_id: z.string().describe('Counter ID'),
      },
    },
    async ({ counter_id }) => {
      if (!counter_id?.trim()) return errorResult('counter_id is required');
      const res = await sendCommand(dirs, 'deleteCounter', { counterId: counter_id });
      if (!res.success) return errorResult(res.error ?? 'Failed to delete counter');
      return okResult({ success: true, counterId: counter_id });
    },
  );
}