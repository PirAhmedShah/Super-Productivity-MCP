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
import { registerBatchTools } from '../../src/tools/batch.js';
import { registerContextTools } from '../../src/tools/context.js';
import { registerStateTools } from '../../src/tools/state.js';
import { registerCounterTools } from '../../src/tools/counters.js';
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
  registerBatchTools(server, dirs);
  registerContextTools(server, dirs);
  registerStateTools(server, dirs);
  registerCounterTools(server, dirs);

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

  it('batch_update_project returns createdTaskIds mapping over the wire', async () => {
    mockSend.mockResolvedValueOnce(mockResponse({
      success: true,
      createdTaskIds: { tmp1: 'real-1', tmp2: 'real-2' },
      errors: [],
    }));
    const c = await withServer([]);
    try {
      const msg = await c.call('batch_update_project', {
        project_id: 'p1',
        operations: [
          { type: 'create', temp_id: 'tmp1', data: { title: 'A', is_done: true } },
          { type: 'create', temp_id: 'tmp2', data: { title: 'B', time_estimate: 3600000 } },
        ],
      });
      expect(msg.result.isError).toBeFalsy();
      const payload = JSON.parse(msg.result.content[0].text);
      expect(payload.success).toBe(true);
      expect(payload.createdTaskIds).toEqual({ tmp1: 'real-1', tmp2: 'real-2' });
      expect(payload.errors).toEqual([]);
    } finally {
      await c.close();
    }
  });

  it('batch_update_project sends snake_case ops mapped to SP camelCase', async () => {
    mockSend.mockResolvedValueOnce(mockResponse({ success: true, createdTaskIds: {}, errors: [] }));
    const c = await withServer([]);
    try {
      await c.call('batch_update_project', {
        project_id: 'p1',
        operations: [
          { type: 'update', task_id: 'real-1', updates: { title: 'B', is_done: true } },
          { type: 'delete', task_id: 'real-2' },
          { type: 'reorder', task_ids: ['tmp1', 'real-1'] },
        ],
      });
      const [, action, fields] = mockSend.mock.calls.at(-1)! as unknown as [unknown, string, Record<string, unknown>];
      expect(action).toBe('batchUpdateForProject');
      expect((fields.data as { projectId: string }).projectId).toBe('p1');
      expect(fields.data).toMatchObject({
        operations: [
          { type: 'update', taskId: 'real-1', updates: { title: 'B', isDone: true } },
          { type: 'delete', taskId: 'real-2' },
          { type: 'reorder', taskIds: ['tmp1', 'real-1'] },
        ],
      });
    } finally {
      await c.close();
    }
  });

  it('batch_update_project surfaces a plugin error result', async () => {
    mockSend.mockResolvedValueOnce(mockResponse({
      success: false,
      createdTaskIds: {},
      errors: ['taskId real-1 not found'],
    }));
    const c = await withServer([]);
    try {
      const msg = await c.call('batch_update_project', {
        project_id: 'p1',
        operations: [{ type: 'update', task_id: 'real-1', updates: { title: 'X' } }],
      });
      expect(msg.result.isError).toBeFalsy();
      const payload = JSON.parse(msg.result.content[0].text);
      expect(payload.success).toBe(false);
      expect(payload.errors).toContain('taskId real-1 not found');
    } finally {
      await c.close();
    }
  });

  it('get_active_work_context returns the current work context', async () => {
    mockSend.mockResolvedValueOnce(mockResponse({
      id: 'wc-1',
      type: 'PROJECT',
      title: 'Career Branding',
      taskIds: ['t1'],
    }));
    const c = await withServer([]);
    try {
      const msg = await c.call('get_active_work_context', {});
      expect(msg.result.isError).toBeFalsy();
      const payload = JSON.parse(msg.result.content[0].text);
      expect(payload.context).toEqual({ id: 'wc-1', type: 'PROJECT', title: 'Career Branding', taskIds: ['t1'] });
    } finally {
      await c.close();
    }
  });

  it('get_app_state normalizes SP maps into arrays', async () => {
    mockSend.mockResolvedValueOnce(mockResponse({
      tasks: { t1: task({ id: 't1' }) },
      projects: { p1: PROJECTS[0] },
      tags: { t1: TAGS[0] },
      notes: { n1: { id: 'n1', content: 'hello' } },
      taskRepeatCfgs: {},
      simpleCounters: { c1: { value: 1 } },
      globalConfig: {},
    }));
    const c = await withServer([]);
    try {
      const msg = await c.call('get_app_state', {});
      expect(msg.result.isError).toBeFalsy();
      const payload = JSON.parse(msg.result.content[0].text);
      expect(Array.isArray(payload.state.tasks)).toBe(true);
      expect(payload.state.tasks[0].id).toBe('t1');
      expect(Array.isArray(payload.state.projects)).toBe(true);
      expect(payload.state.projects[0].id).toBe('p1');
      expect(Array.isArray(payload.state.tags)).toBe(true);
      expect(Array.isArray(payload.state.notes)).toBe(true);
      expect(payload.state.notes[0].content).toBe('hello');
      expect(payload.savedTo).toBeNull();
      expect(payload.state.globalConfig).toEqual({});
    } finally {
      await c.close();
    }
  });

  it('counter tools round-trip over the wire', async () => {
    mockSend.mockResolvedValueOnce(mockResponse({ c1: 2, c2: 0 }));
    const c = await withServer([]);
    try {
      const msg = await c.call('get_all_counters', {});
      expect(msg.result.isError).toBeFalsy();
      expect(JSON.parse(msg.result.content[0].text).counters).toEqual({ c1: 2, c2: 0 });
    } finally {
      await c.close();
    }
  });

  it('increment_counter passes the counter id and incrementBy to the plugin', async () => {
    mockSend.mockResolvedValueOnce(mockResponse(3));
    const c = await withServer([]);
    try {
      const msg = await c.call('increment_counter', { counter_id: 'c1', increment_by: 2 });
      expect(msg.result.isError).toBeFalsy();
      expect(JSON.parse(msg.result.content[0].text).value).toBe(3);
      const [, action, fields] = mockSend.mock.calls.at(-1)! as unknown as [unknown, string, Record<string, unknown>];
      expect(action).toBe('incrementCounter');
      expect(fields).toEqual({ counterId: 'c1', incrementBy: 2 });
    } finally {
      await c.close();
    }
  });
});
