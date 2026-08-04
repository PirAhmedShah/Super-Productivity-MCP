import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';

vi.mock('../../src/ipc/command-sender.js', () => ({
  sendCommand: vi.fn(),
}));

import { sendCommand } from '../../src/ipc/command-sender.js';
import { registerTaskTools } from '../../src/tools/tasks.js';
import { registerScheduleTools, localDateStr } from '../../src/tools/schedule.js';
import { invalidateRefs } from '../../src/enrich.js';
import type { ResolvedDirs } from '../../src/ipc/directories.js';
import type { Response } from '../../src/ipc/types.js';

const mockSend = vi.mocked(sendCommand);
const dirs: ResolvedDirs = { base: '/tmp/proto', commands: '/tmp/proto/pc', responses: '/tmp/proto/pr' };

const HOUR = 3_600_000;
const startOfToday = new Date();
startOfToday.setHours(0, 0, 0, 0);
const TODAY_MS = startOfToday.getTime();
const TODAY = localDateStr();

const PROJECTS = [{ id: 'p1', title: 'Career Branding', theme: { primary: '#2196F3' } }];
const TAGS = [{ id: 't1', title: 'important', theme: { primary: '#e11826' } }];

const task = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 't1',
  title: 'Task',
  isDone: false,
  projectId: 'p1',
  parentId: null,
  tagIds: ['t1'],
  notes: '',
  dueDay: null,
  dueWithTime: null,
  plannedAt: null,
  timeEstimate: 0,
  timeSpent: 0,
  doneOn: null,
  repeatCfgId: null,
  ...overrides,
});

function mockResponse(result: unknown): Response {
  return { success: true, result, timestamp: Date.now() };
}

interface ToolClient {
  call: (name: string, args: Record<string, unknown>) => Promise<any>;
  close: () => Promise<void>;
}

async function withServer(tasks: Record<string, unknown>[]): Promise<ToolClient> {
  mockSend.mockImplementation(async (_d: ResolvedDirs, action: string) => {
    if (action === 'getAllProjects') return mockResponse(PROJECTS);
    if (action === 'getAllTags') return mockResponse(TAGS);
    if (action === 'getTasks') return mockResponse(tasks);
    return mockResponse(null);
  });

  invalidateRefs(dirs);
  const server = new McpServer({ name: 'test', version: '1.0.0' });
  registerTaskTools(server, dirs);
  registerScheduleTools(server, dirs);

  const [client, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  let nextId = 1;
  return {
    call(name, args) {
      return new Promise((resolve) => {
        const id = nextId++;
        client.onmessage = (msg: JSONRPCMessage) => {
          if ('id' in msg && msg.id === id) resolve(msg);
        };
        client.send({
          jsonrpc: '2.0',
          id,
          method: 'tools/call',
          params: { name, arguments: args },
        } as JSONRPCMessage);
      });
    },
    async close() {
      await client.close();
      await serverTransport.close();
    },
  };
}

describe('integration: tools over the MCP protocol', () => {
  beforeEach(() => vi.clearAllMocks());

  it('get_tasks completed_on returns done tasks end-to-end (regression)', async () => {
    const c = await withServer([
      task({ id: 'open1', title: 'Open task' }),
      task({ id: 'done1', title: 'Done today', isDone: true, doneOn: TODAY_MS + 10 * HOUR }),
    ]);
    try {
      const msg = await c.call('get_tasks', { completed_on: TODAY });
      expect(msg.result.isError).toBeFalsy();
      const payload = JSON.parse(msg.result.content[0].text);
      expect(payload.map((t: Record<string, unknown>) => t.id)).toEqual(['done1']);
    } finally {
      await c.close();
    }
  });

  it('get_tasks full objects carry resolved names over the wire', async () => {
    const c = await withServer([task({ id: 'a', title: 'A' })]);
    try {
      const msg = await c.call('get_tasks', {});
      expect(msg.result.isError).toBeFalsy();
      const [t] = JSON.parse(msg.result.content[0].text);
      expect(t.projectTitle).toBe('Career Branding');
      expect(t.tags).toEqual([{ id: 't1', title: 'important', color: '#e11826' }]);
      expect(t.plannedAt).toBeUndefined();
    } finally {
      await c.close();
    }
  });

  it('get_schedule returns a valid time-blocked view over the protocol', async () => {
    const c = await withServer([
      task({ id: 'a', title: 'A', dueWithTime: TODAY_MS + 9 * HOUR, timeEstimate: 2 * HOUR }),
      task({ id: 'b', title: 'B', dueWithTime: TODAY_MS + 10 * HOUR, timeEstimate: HOUR }),
    ]);
    try {
      const msg = await c.call('get_schedule', {});
      expect(msg.result.isError).toBeFalsy();
      const data = JSON.parse(msg.result.content[0].text);
      expect(data.scheduled.map((t: Record<string, unknown>) => t.taskId)).toEqual(['a', 'b']);
      expect(data.overlaps[0].taskIds).toEqual(['a', 'b']);
      expect(data.summary.scheduledCount).toBe(2);
    } finally {
      await c.close();
    }
  });

  it('invalid arguments fail zod validation with isError', async () => {
    const c = await withServer([]);
    try {
      const msg = await c.call('get_tasks', { sort_by: 'not-a-sort' });
      expect(msg.result.isError).toBe(true);
      expect(msg.result.content[0].text).toContain('Invalid arguments for tool get_tasks');
    } finally {
      await c.close();
    }
  });

  it('plugin failure surfaces as a tool error result over the wire', async () => {
    mockSend.mockResolvedValueOnce({ success: false, error: 'SP not responding', timestamp: Date.now() });
    const c = await withServer([]);
    try {
      const msg = await c.call('get_tasks', {});
      expect(msg.result.isError).toBe(true);
      expect(JSON.parse(msg.result.content[0].text).error).toContain('SP not responding');
    } finally {
      await c.close();
    }
  });
});
