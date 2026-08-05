import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock sendCommand before importing the modules under test (tools + enrich both use it).
vi.mock('../../../src/ipc/command-sender.js', () => ({
  sendCommand: vi.fn(),
}));

import { sendCommand } from '../../../src/ipc/command-sender.js';
import { registerTaskTools } from '../../../src/tools/tasks.js';
import { registerScheduleTools, localDateStr } from '../../../src/tools/schedule.js';
import { invalidateRefs } from '../../../src/enrich.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ResolvedDirs } from '../../../src/ipc/directories.js';
import type { Response } from '../../../src/ipc/types.js';

const mockSend = vi.mocked(sendCommand);
const dirs: ResolvedDirs = { base: '/tmp/handlers', commands: '/tmp/handlers/pc', responses: '/tmp/handlers/pr' };

const HOUR = 3_600_000;
const startOfToday = new Date();
startOfToday.setHours(0, 0, 0, 0);
const TODAY_MS = startOfToday.getTime();
const TODAY = localDateStr();
const TOMORROW_MS = TODAY_MS + 24 * HOUR;

const PROJECTS = [{ id: 'p1', title: 'Career Branding', theme: { primary: '#2196F3' } }];
const TAGS = [{ id: 't1', title: 'important', theme: { primary: '#e11826' } }];

type TaskFixture = Record<string, unknown>;
const task = (overrides: TaskFixture = {}): TaskFixture => ({
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

// Drive the plugin side: getTasks returns ALL fixtures (server-side filtering is the
// source of truth in this codebase), and getAllProjects/getAllTags feed enrichment.
function mockPlugin(tasks: TaskFixture[]): void {
  mockSend.mockImplementation(async (_d: ResolvedDirs, action: string) => {
    if (action === 'getAllProjects') return mockResponse(PROJECTS);
    if (action === 'getAllTags') return mockResponse(TAGS);
    if (action === 'getTasks') return mockResponse(tasks);
    return mockResponse(null);
  });
}

type ToolHandler = (args: Record<string, unknown>) => unknown;
const registeredTools: Record<string, ToolHandler> = {};

const mockServer = {
  registerTool: vi.fn((_name: string, _config: unknown, cb: ToolHandler) => {
    registeredTools[_name] = cb;
  }),
} as unknown as McpServer;

function callTool(name: string, args: Record<string, unknown> = {}): Promise<any> {
  return Promise.resolve(registeredTools[name](args));
}

function okData(res: any): any {
  expect(res.isError).toBeFalsy();
  return JSON.parse(res.content[0].text);
}

function errMsg(res: any): string {
  expect(res.isError).toBe(true);
  return JSON.parse(res.content[0].text).error;
}

describe('tool handlers (full pipeline: fetch → filter → enrich)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateRefs(dirs);
    Object.keys(registeredTools).forEach(k => delete registeredTools[k]);
    registerTaskTools(mockServer, dirs);
    registerScheduleTools(mockServer, dirs);
  });

  describe('get_tasks', () => {
    it('completed_on returns done tasks even without include_done (regression)', async () => {
      mockPlugin([
        task({ id: 'open1', title: 'Open task' }),
        task({ id: 'done1', title: 'Done today', isDone: true, doneOn: TODAY_MS + 10 * HOUR }),
      ]);
      const data = okData(await callTool('get_tasks', { completed_on: TODAY }));
      expect(data.map((t: TaskFixture) => t.id)).toEqual(['done1']);
    });

    it('completed_on + include_done returns the same set', async () => {
      mockPlugin([
        task({ id: 'done1', title: 'Done today', isDone: true, doneOn: TODAY_MS + 10 * HOUR }),
      ]);
      const data = okData(await callTool('get_tasks', { completed_on: TODAY, include_done: true }));
      expect(data.map((t: TaskFixture) => t.id)).toEqual(['done1']);
    });

    it('still strips done tasks by default (completed_on not set)', async () => {
      mockPlugin([
        task({ id: 'open1', title: 'Open task' }),
        task({ id: 'done1', title: 'Done task', isDone: true, doneOn: TODAY_MS + 10 * HOUR }),
      ]);
      const data = okData(await callTool('get_tasks'));
      expect(data.map((t: TaskFixture) => t.id)).toEqual(['open1']);
    });

    it('scheduled_on returns tasks planned on that date only', async () => {
      mockPlugin([
        task({ id: 'today1', title: 'Planned today', dueWithTime: TODAY_MS + 9 * HOUR, timeEstimate: HOUR }),
        task({ id: 'tomorrow1', title: 'Planned tomorrow', dueWithTime: TOMORROW_MS + 9 * HOUR, timeEstimate: HOUR }),
      ]);
      const data = okData(await callTool('get_tasks', { scheduled_on: TODAY }));
      expect(data.map((t: TaskFixture) => t.id)).toEqual(['today1']);
    });

    it('overlapping returns only members of a conflict cluster', async () => {
      mockPlugin([
        task({ id: 'a', title: 'A', dueWithTime: TODAY_MS + 9 * HOUR, timeEstimate: 2 * HOUR }),
        task({ id: 'b', title: 'B', dueWithTime: TODAY_MS + 10 * HOUR, timeEstimate: HOUR }),
        task({ id: 'c', title: 'C isolated', dueWithTime: TODAY_MS + 15 * HOUR, timeEstimate: HOUR }),
      ]);
      const data = okData(await callTool('get_tasks', { overlapping: true }));
      expect(data.map((t: TaskFixture) => t.id).sort()).toEqual(['a', 'b']);
    });

    it('sort_by time_estimate desc orders through the handler', async () => {
      mockPlugin([
        task({ id: 'short', title: 'Short', timeEstimate: HOUR }),
        task({ id: 'long', title: 'Long', timeEstimate: 4 * HOUR }),
        task({ id: 'mid', title: 'Mid', timeEstimate: 2 * HOUR }),
      ]);
      const data = okData(await callTool('get_tasks', { sort_by: 'time_estimate', sort_dir: 'desc' }));
      expect(data.map((t: TaskFixture) => t.id)).toEqual(['long', 'mid', 'short']);
    });

    it('fields selection resolves projectTitle and tags via enrichment', async () => {
      mockPlugin([task({ id: 'a', title: 'A' })]);
      const data = okData(await callTool('get_tasks', { fields: ['id', 'title', 'projectTitle', 'tags'] }));
      expect(data[0]).toEqual({
        id: 'a',
        title: 'A',
        projectTitle: 'Career Branding',
        tags: [{ id: 't1', title: 'important', color: '#e11826' }],
      });
    });

    it('full objects are enriched and expose canonical plannedTime (no plannedAt)', async () => {
      mockPlugin([task({ id: 'a', title: 'A', dueWithTime: TODAY_MS + 9 * HOUR })]);
      const [t] = okData(await callTool('get_tasks'));
      expect(t.projectTitle).toBe('Career Branding');
      expect(t.tags).toEqual([{ id: 't1', title: 'important', color: '#e11826' }]);
      expect(t.plannedTime).toBe(TODAY_MS + 9 * HOUR);
      expect(t.plannedAt).toBeUndefined();
    });

    it('include_schedule appends the derived schedule block', async () => {
      mockPlugin([task({ id: 'a', title: 'A', dueWithTime: TODAY_MS + 9 * HOUR, timeEstimate: HOUR })]);
      const [t] = okData(await callTool('get_tasks', { include_schedule: true }));
      expect(t.schedule.startMs).toBe(TODAY_MS + 9 * HOUR);
      expect(t.schedule.startTime).toBe('09:00');
      expect(t.schedule.endTime).toBe('10:00');
      expect(t.schedule.durationMs).toBe(HOUR);
    });

    it('search_query matches notes', async () => {
      mockPlugin([
        task({ id: 'a', title: 'A', notes: 'find me in notes' }),
        task({ id: 'b', title: 'B' }),
      ]);
      const data = okData(await callTool('get_tasks', { search_query: 'find me' }));
      expect(data.map((t: TaskFixture) => t.id)).toEqual(['a']);
    });

    it('propagates plugin failure as an error result', async () => {
      mockSend.mockResolvedValueOnce({ success: false, error: 'SP not responding', timestamp: Date.now() });
      const msg = errMsg(await callTool('get_tasks'));
      expect(msg).toContain('SP not responding');
    });
  });

  describe('get_task', () => {
    it('returns fully-resolved detail: parent, subtasks, schedule, 14-day time', async () => {
      const main = task({
        id: 'main1', title: 'Main', parentId: 'parent1',
        dueWithTime: TODAY_MS + 9 * HOUR, timeEstimate: HOUR,
        timeSpentOnDay: { [TODAY]: 1_500_000 },
      });
      mockPlugin([
        main,
        task({ id: 'parent1', title: 'Parent task' }),
        task({ id: 'child1', title: 'Child task', parentId: 'main1', isDone: true }),
        task({ id: 'other', title: 'Unrelated' }),
      ]);
      const data = okData(await callTool('get_task', { task_id: 'main1' }));
      expect(data.task.id).toBe('main1');
      expect(data.task.projectTitle).toBe('Career Branding');
      expect(data.task.plannedTime).toBe(TODAY_MS + 9 * HOUR);
      expect(data.task.plannedAt).toBeUndefined();
      expect(data.task.schedule.startTime).toBe('09:00');
      expect(data.task.schedule.endTime).toBe('10:00');
      expect(data.parent).toEqual({ id: 'parent1', title: 'Parent task' });
      expect(data.subtasks).toEqual([{ id: 'child1', title: 'Child task', isDone: true }]);
      expect(data.timeSpentLast14Days).toEqual({ [TODAY]: 1_500_000 });
    });

    it('returns null parent and empty subtasks when none exist', async () => {
      mockPlugin([task({ id: 'solo', title: 'Solo' })]);
      const data = okData(await callTool('get_task', { task_id: 'solo' }));
      expect(data.parent).toBeNull();
      expect(data.subtasks).toEqual([]);
    });

    it('returns an error for an unknown id', async () => {
      mockPlugin([task({ id: 'known', title: 'Known' })]);
      const msg = errMsg(await callTool('get_task', { task_id: 'nope' }));
      expect(msg).toContain('Task not found');
    });
  });

  describe('get_schedule', () => {
    it('builds the time-blocked view with overlaps and summary (include_done)', async () => {
      mockPlugin([
        task({ id: 'a', title: 'A', dueWithTime: TODAY_MS + 9 * HOUR, timeEstimate: 2 * HOUR }),
        task({ id: 'b', title: 'B', dueWithTime: TODAY_MS + 10 * HOUR, timeEstimate: HOUR }),
        task({ id: 'c', title: 'C due today, unsized', dueDay: TODAY }),
        task({ id: 'done1', title: 'Done today', isDone: true, doneOn: TODAY_MS + 11 * HOUR, dueWithTime: TODAY_MS + 11 * HOUR, timeEstimate: HOUR }),
      ]);
      const data = okData(await callTool('get_schedule', { include_done: true }));
      expect(data.scheduled.map((t: TaskFixture) => t.taskId)).toEqual(['a', 'b']);
      expect(data.overlaps).toHaveLength(1);
      expect(data.overlaps[0].taskIds).toEqual(['a', 'b']);
      expect(data.unscheduledInRange.map((t: TaskFixture) => t.taskId)).toEqual(['c']);
      expect(data.completedInRange.map((t: TaskFixture) => t.taskId)).toEqual(['done1']);
      expect(data.summary.scheduledCount).toBe(2);
      expect(data.summary.overlapCount).toBe(1);
      expect(data.summary.completedCount).toBe(1);
      expect(data.summary.totalDurationMs).toBe(3 * HOUR);
    });

    it('done tasks are NOT double-counted in scheduled (regression: no double-count)', async () => {
      mockPlugin([
        task({ id: 'done1', title: 'Done planned today', isDone: true, doneOn: TODAY_MS + 10 * HOUR, dueWithTime: TODAY_MS + 9 * HOUR, timeEstimate: HOUR }),
      ]);
      const data = okData(await callTool('get_schedule', { include_done: true }));
      expect(data.scheduled).toHaveLength(0);
      expect(data.completedInRange.map((t: TaskFixture) => t.taskId)).toEqual(['done1']);
      expect(data.summary.scheduledCount).toBe(0);
    });

    it('excludes done tasks entirely when include_done is false', async () => {
      mockPlugin([
        task({ id: 'a', title: 'A', dueWithTime: TODAY_MS + 9 * HOUR, timeEstimate: HOUR }),
        task({ id: 'done1', title: 'Done today', isDone: true, doneOn: TODAY_MS + 10 * HOUR, dueWithTime: TODAY_MS + 10 * HOUR, timeEstimate: HOUR }),
      ]);
      const data = okData(await callTool('get_schedule'));
      expect(data.scheduled.map((t: TaskFixture) => t.taskId)).toEqual(['a']);
      expect(data.completedInRange).toHaveLength(0);
      expect(data.summary.completedCount).toBe(0);
    });

    it('rejects malformed dates', async () => {
      mockPlugin([]);
      const msg = errMsg(await callTool('get_schedule', { start_date: 'yesterday' }));
      expect(msg).toContain('YYYY-MM-DD');
    });

    it('rejects start_date after end_date', async () => {
      mockPlugin([]);
      const msg = errMsg(await callTool('get_schedule', { start_date: '2026-08-05', end_date: '2026-08-04' }));
      expect(msg).toContain('must not be after');
    });

    it('includes planned subtasks by default (container pattern)', async () => {
      mockPlugin([
        task({ id: 'parent1', title: 'Container', timeEstimate: 0, dueWithTime: null }),
        task({ id: 'child1', title: 'Child A', parentId: 'parent1', dueWithTime: TODAY_MS + 9 * HOUR, timeEstimate: HOUR }),
        task({ id: 'child2', title: 'Child B', parentId: 'parent1', dueWithTime: TODAY_MS + 10 * HOUR, timeEstimate: 2 * HOUR }),
        task({ id: 'top1', title: 'Top level', dueWithTime: TODAY_MS + 12 * HOUR, timeEstimate: HOUR }),
      ]);
      const data = okData(await callTool('get_schedule'));
      expect(data.scheduled.map((t: TaskFixture) => t.taskId)).toEqual(['child1', 'child2', 'top1']);
      expect(data.summary.scheduledCount).toBe(3);
      expect(data.summary.totalDurationMs).toBe(4 * HOUR);
      expect(data.filteredSubtasks).toBeNull();
    });

    it('include_subtasks: false opts out and reports hidden subtasks', async () => {
      mockPlugin([
        task({ id: 'parent1', title: 'Container', timeEstimate: 0, dueWithTime: null }),
        task({ id: 'child1', title: 'Child A', parentId: 'parent1', dueWithTime: TODAY_MS + 9 * HOUR, timeEstimate: HOUR }),
        task({ id: 'top1', title: 'Top level', dueWithTime: TODAY_MS + 11 * HOUR, timeEstimate: HOUR }),
      ]);
      const data = okData(await callTool('get_schedule', { include_subtasks: false }));
      expect(data.scheduled.map((t: TaskFixture) => t.taskId)).toEqual(['top1']);
      expect(data.summary.scheduledCount).toBe(1);
      expect(data.filteredSubtasks).toEqual({ count: 1, taskIds: ['child1'] });
    });

    it('overlap clusters include subtask conflicts by default', async () => {
      mockPlugin([
        task({ id: 'parent1', title: 'Container', timeEstimate: 0, dueWithTime: null }),
        task({ id: 'child1', title: 'Child A', parentId: 'parent1', dueWithTime: TODAY_MS + 9 * HOUR, timeEstimate: HOUR }),
        task({ id: 'child2', title: 'Child B', parentId: 'parent1', dueWithTime: TODAY_MS + 9 * HOUR + 30 * 60 * 1000, timeEstimate: HOUR }),
      ]);
      const data = okData(await callTool('get_schedule'));
      expect(data.overlaps).toHaveLength(1);
      expect(data.overlaps[0].taskIds).toEqual(['child1', 'child2']);
      expect(data.summary.overlapCount).toBe(1);
      expect(data.summary.overlappingTaskCount).toBe(2);
    });

    it('container parents (0 estimate, unplanned) never double-count or fake-conflict', async () => {
      mockPlugin([
        task({ id: 'parent1', title: 'Container', timeEstimate: 0, dueWithTime: null }),
        task({ id: 'child1', title: 'Child A', parentId: 'parent1', dueWithTime: TODAY_MS + 9 * HOUR, timeEstimate: HOUR }),
      ]);
      const data = okData(await callTool('get_schedule'));
      expect(data.scheduled.map((t: TaskFixture) => t.taskId)).toEqual(['child1']);
      expect(data.overlaps).toHaveLength(0);
      expect(data.summary.scheduledCount).toBe(1);
      expect(data.summary.totalDurationMs).toBe(HOUR);
    });

    it('done subtasks land in completedInRange with include_done', async () => {
      mockPlugin([
        task({ id: 'parent1', title: 'Container', timeEstimate: 0, dueWithTime: null }),
        task({ id: 'child1', title: 'Child done', parentId: 'parent1', isDone: true, doneOn: TODAY_MS + 10 * HOUR, dueWithTime: TODAY_MS + 9 * HOUR, timeEstimate: HOUR }),
      ]);
      const data = okData(await callTool('get_schedule', { include_done: true }));
      expect(data.completedInRange.map((t: TaskFixture) => t.taskId)).toEqual(['child1']);
      expect(data.summary.completedCount).toBe(1);
    });
  });
});
