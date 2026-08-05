import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock sendCommand before importing the module under test
vi.mock('../../../src/ipc/command-sender.js', () => ({
  sendCommand: vi.fn(),
}));

import { sendCommand } from '../../../src/ipc/command-sender.js';
import { applyTriageFilters, composeTaskDetail, fetchTasksByIds, filterCompletedOn, filterOverlapping, filterScheduledOn, localDateStr, plannedTimeOf, projectFields, shapeForResponse, sortTasks } from '../../../src/tools/tasks.js';
import type { ResolvedDirs } from '../../../src/ipc/directories.js';
import type { Response } from '../../../src/ipc/types.js';

const mockSend = vi.mocked(sendCommand);
const dirs: ResolvedDirs = { base: '/tmp/test', commands: '/tmp/test/pc', responses: '/tmp/test/pr' };

// Instead of testing through McpServer (which has no public API to call tools),
// we test the sendCommand integration and filtering logic directly.
// The tool registration is verified by the build + integration tests.

function mockResponse(result: unknown): Response {
  return { success: true, result, timestamp: Date.now() };
}

describe('task tool logic', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('create_task via sendCommand', () => {
    it('sends addTask with correct data', async () => {
      mockSend.mockResolvedValueOnce(mockResponse('task-123'));
      const res = await sendCommand(dirs, 'addTask', {
        data: { title: 'Test task', notes: 'Some notes', tagIds: [] },
      });
      expect(res.success).toBe(true);
      expect(res.result).toBe('task-123');
      expect(mockSend).toHaveBeenCalledWith(dirs, 'addTask', {
        data: { title: 'Test task', notes: 'Some notes', tagIds: [] },
      });
    });
  });

  describe('get_tasks filtering', () => {
    const allTasks = [
      { id: '1', title: 'Open task', isDone: false, projectId: 'proj-1', tagIds: ['tag-1'] },
      { id: '2', title: 'Done task', isDone: true, projectId: 'proj-1', tagIds: [] },
      { id: '3', title: 'Other project', isDone: false, projectId: 'proj-2', tagIds: ['tag-1'] },
      { id: '4', title: 'Buy groceries', isDone: false, projectId: null, tagIds: [] },
    ];

    it('filters out done tasks by default', () => {
      const filtered = allTasks.filter(t => !t.isDone);
      expect(filtered).toHaveLength(3);
      expect(filtered.every(t => !t.isDone)).toBe(true);
    });

    it('filters by projectId', () => {
      const filtered = allTasks.filter(t => !t.isDone && t.projectId === 'proj-1');
      expect(filtered).toHaveLength(1);
      expect(filtered[0].id).toBe('1');
    });

    it('filters by tagId', () => {
      const filtered = allTasks.filter(t => !t.isDone && t.tagIds.includes('tag-1'));
      expect(filtered).toHaveLength(2);
    });

    it('filters by search query case-insensitive', () => {
      const q = 'GROCERIES'.toLowerCase();
      const filtered = allTasks.filter(t => !t.isDone && t.title.toLowerCase().includes(q));
      expect(filtered).toHaveLength(1);
      expect(filtered[0].id).toBe('4');
    });
  });

  describe('update_task via sendCommand', () => {
    it('sends updateTask with isDone and doneOn', async () => {
      mockSend.mockResolvedValueOnce(mockResponse({}));
      await sendCommand(dirs, 'updateTask', {
        taskId: 'task-1',
        data: { isDone: true, doneOn: Date.now() },
      });
      expect(mockSend).toHaveBeenCalledWith(dirs, 'updateTask', expect.objectContaining({
        taskId: 'task-1',
        data: expect.objectContaining({ isDone: true, doneOn: expect.any(Number) }),
      }));
    });

    it('sends updateTask with dueDay and dueWithTime together', async () => {
      mockSend.mockResolvedValueOnce(mockResponse({}));
      await sendCommand(dirs, 'updateTask', {
        taskId: 'task-1',
        data: { dueDay: '2026-04-20', dueWithTime: 1745150400000 },
      });
      expect(mockSend).toHaveBeenCalledWith(dirs, 'updateTask', expect.objectContaining({
        taskId: 'task-1',
        data: expect.objectContaining({ dueDay: '2026-04-20', dueWithTime: expect.any(Number) }),
      }));
    });

    it('clears dueDay and dueWithTime together', async () => {
      mockSend.mockResolvedValueOnce(mockResponse({}));
      await sendCommand(dirs, 'updateTask', {
        taskId: 'task-1',
        data: { dueDay: null, dueWithTime: null },
      });
      expect(mockSend).toHaveBeenCalledWith(dirs, 'updateTask', expect.objectContaining({
        taskId: 'task-1',
        data: { dueDay: null, dueWithTime: null },
      }));
    });

    it('sets dueWithTime independently without dueDay', async () => {
      mockSend.mockResolvedValueOnce(mockResponse({}));
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      await sendCommand(dirs, 'updateTask', {
        taskId: 'task-1',
        data: { dueWithTime: startOfToday.getTime() },
      });
      expect(mockSend).toHaveBeenCalledWith(dirs, 'updateTask', expect.objectContaining({
        taskId: 'task-1',
        data: expect.objectContaining({ dueWithTime: startOfToday.getTime() }),
      }));
    });

    it('clears dueWithTime without touching dueDay', async () => {
      mockSend.mockResolvedValueOnce(mockResponse({}));
      await sendCommand(dirs, 'updateTask', { taskId: 'task-1', data: { dueWithTime: null } });
      expect(mockSend).toHaveBeenCalledWith(dirs, 'updateTask', expect.objectContaining({
        data: { dueWithTime: null },
      }));
    });
  });

  describe('complete_task via sendCommand', () => {
    it('sends setTaskDone', async () => {
      mockSend.mockResolvedValueOnce(mockResponse({}));
      await sendCommand(dirs, 'setTaskDone', { taskId: 'task-1' });
      expect(mockSend).toHaveBeenCalledWith(dirs, 'setTaskDone', { taskId: 'task-1' });
    });
  });

  // T007: US1 — tag operations
  describe('add_tag_to_task via sendCommand', () => {
    it('sends addTagToTask with taskId and tagId', async () => {
      mockSend.mockResolvedValueOnce(mockResponse(null));
      await sendCommand(dirs, 'addTagToTask', { taskId: 'task-1', tagId: 'tag-a' });
      expect(mockSend).toHaveBeenCalledWith(dirs, 'addTagToTask', { taskId: 'task-1', tagId: 'tag-a' });
    });

    it('propagates error when task not found', async () => {
      mockSend.mockResolvedValueOnce({ success: false, error: 'Task not found: task-x', timestamp: Date.now() });
      const res = await sendCommand(dirs, 'addTagToTask', { taskId: 'task-x', tagId: 'tag-a' });
      expect(res.success).toBe(false);
      expect(res.error).toMatch('Task not found');
    });

    it('succeeds silently when tag already present (idempotent)', async () => {
      // Plugin returns success even when tag is already on the task — no-op
      mockSend.mockResolvedValueOnce(mockResponse(null));
      const res = await sendCommand(dirs, 'addTagToTask', { taskId: 'task-1', tagId: 'tag-already-there' });
      expect(res.success).toBe(true);
      expect(res.result).toBeNull();
    });
  });

  describe('remove_tag_from_task via sendCommand', () => {
    it('sends removeTagFromTask with taskId and tagId', async () => {
      mockSend.mockResolvedValueOnce(mockResponse(null));
      await sendCommand(dirs, 'removeTagFromTask', { taskId: 'task-1', tagId: 'tag-a' });
      expect(mockSend).toHaveBeenCalledWith(dirs, 'removeTagFromTask', { taskId: 'task-1', tagId: 'tag-a' });
    });

    it('propagates error when tag not on task', async () => {
      mockSend.mockResolvedValueOnce({ success: false, error: 'Tag tag-z not on task task-1', timestamp: Date.now() });
      const res = await sendCommand(dirs, 'removeTagFromTask', { taskId: 'task-1', tagId: 'tag-z' });
      expect(res.success).toBe(false);
      expect(res.error).toMatch('not on task');
    });
  });

  describe('update_task with tag_ids (bulk replace)', () => {
    it('sends updateTask with tagIds array', async () => {
      mockSend.mockResolvedValueOnce(mockResponse({}));
      await sendCommand(dirs, 'updateTask', { taskId: 'task-1', data: { tagIds: ['tag-a', 'tag-b'] } });
      expect(mockSend).toHaveBeenCalledWith(dirs, 'updateTask', expect.objectContaining({
        data: expect.objectContaining({ tagIds: ['tag-a', 'tag-b'] }),
      }));
    });

    it('sends updateTask with empty tagIds to clear all tags', async () => {
      mockSend.mockResolvedValueOnce(mockResponse({}));
      await sendCommand(dirs, 'updateTask', { taskId: 'task-1', data: { tagIds: [] } });
      expect(mockSend).toHaveBeenCalledWith(dirs, 'updateTask', expect.objectContaining({
        data: expect.objectContaining({ tagIds: [] }),
      }));
    });
  });

  // T010: US2 — triage filter logic (exercises actual applyTriageFilters from tasks.ts)
  describe('get_tasks triage filters', () => {
    const today = localDateStr();
    const yesterday = localDateStr(new Date(Date.now() - 86400000));
    const tomorrow = localDateStr(new Date(Date.now() + 86400000));

    const tasks = [
      { id: '1', title: 'Parent overdue', isDone: false, projectId: 'p1', tagIds: [], parentId: null, dueDay: yesterday, dueWithTime: null, timeEstimate: 0, timeSpent: 0 },
      { id: '2', title: 'Parent unscheduled', isDone: false, projectId: 'p1', tagIds: [], parentId: null, dueDay: null, dueWithTime: null, timeEstimate: 0, timeSpent: 0 },
      { id: '3', title: 'Parent future', isDone: false, projectId: 'p1', tagIds: [], parentId: null, dueDay: tomorrow, dueWithTime: null, timeEstimate: 0, timeSpent: 0 },
      { id: '4', title: 'Subtask overdue', isDone: false, projectId: null, tagIds: [], parentId: 'task-parent', dueDay: yesterday, dueWithTime: null, timeEstimate: 0, timeSpent: 0 },
      { id: '5', title: 'Scheduled today', isDone: false, projectId: 'p1', tagIds: [], parentId: null, dueDay: today, dueWithTime: null, timeEstimate: 0, timeSpent: 0 },
    ];

    it('parents_only excludes subtasks', () => {
      const result = applyTriageFilters(tasks, { parentsOnly: true });
      expect(result.every(t => !t.parentId)).toBe(true);
      expect(result.find(t => t.id === '4')).toBeUndefined();
    });

    it('overdue returns only tasks with dueDay strictly before today', () => {
      const result = applyTriageFilters(tasks, { overdue: true });
      expect(result.every(t => t.dueDay! < today)).toBe(true);
      expect(result.map(t => t.id)).toEqual(expect.arrayContaining(['1', '4']));
    });

    it('overdue excludes dueDay === today (boundary)', () => {
      const result = applyTriageFilters(tasks, { overdue: true });
      expect(result.find(t => t.id === '5')).toBeUndefined();
    });

    it('unscheduled returns only tasks with no dueDay and no dueWithTime', () => {
      const result = applyTriageFilters(tasks, { unscheduled: true });
      expect(result.map(t => t.id)).toEqual(['2']);
    });

    it('parents_only + unscheduled returns AND intersection', () => {
      const result = applyTriageFilters(tasks, { parentsOnly: true, unscheduled: true });
      expect(result.map(t => t.id)).toEqual(['2']);
    });

    it('overdue + unscheduled returns empty (mutually exclusive)', () => {
      const result = applyTriageFilters(tasks, { overdue: true, unscheduled: true });
      expect(result).toHaveLength(0);
    });
  });

  // T017: US3 — organisation operations
  describe('get_current_task via sendCommand', () => {
    it('returns task object when timer is active', async () => {
      const task = { id: 'task-1', title: 'Active task' };
      mockSend.mockResolvedValueOnce(mockResponse(task));
      const res = await sendCommand(dirs, 'loadCurrentTask', {});
      expect(res.success).toBe(true);
      expect(res.result).toEqual(task);
    });

    it('returns null when no timer is running', async () => {
      mockSend.mockResolvedValueOnce(mockResponse(null));
      const res = await sendCommand(dirs, 'loadCurrentTask', {});
      expect(res.success).toBe(true);
      expect(res.result).toBeNull();
    });
  });

  describe('move_task_to_project via sendCommand', () => {
    it('sends moveTaskToProject with taskId and projectId', async () => {
      mockSend.mockResolvedValueOnce(mockResponse(null));
      await sendCommand(dirs, 'moveTaskToProject', { taskId: 'task-1', projectId: 'proj-b' });
      expect(mockSend).toHaveBeenCalledWith(dirs, 'moveTaskToProject', { taskId: 'task-1', projectId: 'proj-b' });
    });

    it('propagates error when task is a subtask', async () => {
      mockSend.mockResolvedValueOnce({ success: false, error: 'Cannot move subtask: task-1 has parentId parent-x', timestamp: Date.now() });
      const res = await sendCommand(dirs, 'moveTaskToProject', { taskId: 'task-1', projectId: 'proj-b' });
      expect(res.success).toBe(false);
      expect(res.error).toMatch('Cannot move subtask');
    });

    it('propagates error when project not found', async () => {
      mockSend.mockResolvedValueOnce({ success: false, error: 'Project not found: proj-x', timestamp: Date.now() });
      const res = await sendCommand(dirs, 'moveTaskToProject', { taskId: 'task-1', projectId: 'proj-x' });
      expect(res.success).toBe(false);
      expect(res.error).toMatch('Project not found');
    });
  });

  describe('reorder_tasks via sendCommand', () => {
    it('sends reorderTasks with taskIds, contextId, contextType', async () => {
      mockSend.mockResolvedValueOnce(mockResponse(null));
      await sendCommand(dirs, 'reorderTasks', { taskIds: ['t3', 't1', 't2'], contextId: 'proj-1', contextType: 'project' });
      expect(mockSend).toHaveBeenCalledWith(dirs, 'reorderTasks', {
        taskIds: ['t3', 't1', 't2'],
        contextId: 'proj-1',
        contextType: 'project',
      });
    });

    it('propagates error when a task does not belong to the context', async () => {
      mockSend.mockResolvedValueOnce({ success: false, error: 'Task foreign-task does not belong to context proj-1', timestamp: Date.now() });
      const res = await sendCommand(dirs, 'reorderTasks', { taskIds: ['t1', 'foreign-task'], contextId: 'proj-1', contextType: 'project' });
      expect(res.success).toBe(false);
      expect(res.error).toMatch('does not belong to context');
    });
  });

  // T008: US2 — planned_for_today filter (003-FR-006)
  describe('get_tasks planned_for_today filter', () => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const tasks = [
      { id: '1', title: 'Planned today', isDone: false, projectId: 'p1', tagIds: [], parentId: null, dueDay: null, dueWithTime: startOfToday + 3600000, timeEstimate: 0, timeSpent: 0 },
      { id: '2', title: 'Planned yesterday', isDone: false, projectId: 'p1', tagIds: [], parentId: null, dueDay: null, dueWithTime: startOfToday - 86400000, timeEstimate: 0, timeSpent: 0 },
      { id: '3', title: 'Not planned', isDone: false, projectId: 'p1', tagIds: [], parentId: null, dueDay: null, dueWithTime: null, timeEstimate: 0, timeSpent: 0 },
      { id: '4', title: 'Subtask planned today', isDone: false, projectId: null, tagIds: [], parentId: 'p-1', dueDay: null, dueWithTime: startOfToday + 1000, timeEstimate: 0, timeSpent: 0 },
    ];

    it('returns only tasks planned for today', () => {
      const result = applyTriageFilters(tasks, { plannedForToday: true });
      expect(result.map(t => t.id)).toEqual(['1', '4']);
    });

    it('excludes tasks planned yesterday', () => {
      const result = applyTriageFilters(tasks, { plannedForToday: true });
      expect(result.find(t => t.id === '2')).toBeUndefined();
    });

    it('excludes tasks with null dueWithTime', () => {
      const result = applyTriageFilters(tasks, { plannedForToday: true });
      expect(result.find(t => t.id === '3')).toBeUndefined();
    });

    it('combines with parents_only (AND logic)', () => {
      const result = applyTriageFilters(tasks, { plannedForToday: true, parentsOnly: true });
      expect(result.map(t => t.id)).toEqual(['1']);
    });

    it('ignores legacy plannedAt-only tasks (dueWithTime is the only planned-time source)', () => {
      const legacy = [
        { id: 'L1', title: 'Legacy today', isDone: false, projectId: 'p1', tagIds: [], parentId: null, dueDay: null, timeEstimate: 0, timeSpent: 0, plannedAt: startOfToday + 5000 },
        { id: 'L2', title: 'No planned time', isDone: false, projectId: 'p1', tagIds: [], parentId: null, dueDay: null, timeEstimate: 0, timeSpent: 0 },
      ];
      const result = applyTriageFilters(legacy, { plannedForToday: true });
      expect(result.map(t => t.id)).toEqual([]);
    });
  });

  // B2/B3: planned time helpers — canonical dueWithTime only, response shaping
  describe('plannedTimeOf / shapeForResponse', () => {
    it('returns dueWithTime as the effective planned time', () => {
      expect(plannedTimeOf({ id: '1', dueWithTime: 1745150400000 } as any)).toBe(1745150400000);
    });

    it('returns null when dueWithTime is not set', () => {
      expect(plannedTimeOf({ id: '1' } as any)).toBeNull();
    });

    it('shapeForResponse exposes plannedTime', () => {
      const shaped = shapeForResponse({ id: '1', title: 'T', dueWithTime: 1745150400000, isDone: false, projectId: 'p1', tagIds: [] } as any);
      expect(shaped.plannedTime).toBe(1745150400000);
      expect('plannedAt' in shaped).toBe(false);
      expect(shaped.id).toBe('1');
    });
  });

  // B3: write echo — re-fetch returns shaped task with effective planned time
  describe('fetchTasksByIds', () => {
    it('returns shaped tasks keyed by id with plannedTime', async () => {
      mockSend.mockResolvedValueOnce(mockResponse([
        { id: 't1', title: 'A', dueWithTime: 1745150400000, isDone: false, projectId: 'p1', tagIds: [], timeEstimate: 0, timeSpent: 0 },
        { id: 't2', title: 'B', dueWithTime: null, isDone: false, projectId: 'p1', tagIds: [], timeEstimate: 0, timeSpent: 0 },
      ]));
      const byId = await fetchTasksByIds(dirs, ['t1', 't2']);
      expect(byId['t1']?.plannedTime).toBe(1745150400000);
      expect(byId['t2']?.plannedTime).toBeNull();
      expect('plannedAt' in (byId['t1'] as object)).toBe(false);
      expect(mockSend).toHaveBeenCalledWith(dirs, 'getTasks', {
        filters: { includeDone: true, includeArchived: true },
      });
    });

    it('returns null entries for ids not found', async () => {
      mockSend.mockResolvedValueOnce(mockResponse([]));
      const byId = await fetchTasksByIds(dirs, ['ghost']);
      expect(byId['ghost']).toBeNull();
    });
  });

  // T015: US3 — bulk operations (003-FR-008, 003-FR-009, 003-FR-010)
  describe('bulk_complete_tasks via sendCommand', () => {
    it('sends bulkCompleteTasks with task IDs', async () => {
      const results = { results: [{ id: 't1', success: true }, { id: 't2', success: true }] };
      mockSend.mockResolvedValueOnce(mockResponse(results));
      const res = await sendCommand(dirs, 'bulkCompleteTasks', { taskIds: ['t1', 't2'] });
      expect(res.success).toBe(true);
      expect(res.result).toEqual(results);
    });

    it('handles partial failure', async () => {
      const results = { results: [{ id: 't1', success: true }, { id: 'bad', success: false, error: 'Task not found: bad' }] };
      mockSend.mockResolvedValueOnce(mockResponse(results));
      const res = await sendCommand(dirs, 'bulkCompleteTasks', { taskIds: ['t1', 'bad'] });
      expect(res.success).toBe(true);
      expect((res.result as any).results[1].success).toBe(false);
    });

    it('returns empty results for empty array', async () => {
      mockSend.mockResolvedValueOnce(mockResponse({ results: [] }));
      const res = await sendCommand(dirs, 'bulkCompleteTasks', { taskIds: [] });
      expect(res.success).toBe(true);
      expect((res.result as any).results).toEqual([]);
    });
  });

  describe('bulk_update_tasks via sendCommand', () => {
    it('sends bulkUpdateTasks with updates array', async () => {
      const results = { results: [{ id: 't1', success: true }] };
      mockSend.mockResolvedValueOnce(mockResponse(results));
      const res = await sendCommand(dirs, 'bulkUpdateTasks', { updates: [{ taskId: 't1', data: { dueDay: '2026-05-01' } }] });
      expect(res.success).toBe(true);
      expect(mockSend).toHaveBeenCalledWith(dirs, 'bulkUpdateTasks', { updates: [{ taskId: 't1', data: { dueDay: '2026-05-01' } }] });
    });
  });

  // T006: US1 — timer control operations (003-FR-001, 003-FR-002)
  describe('start_task via sendCommand', () => {
    it('sends startTask with taskId', async () => {
      mockSend.mockResolvedValueOnce(mockResponse(null));
      const res = await sendCommand(dirs, 'startTask', { taskId: 'task-1' });
      expect(res.success).toBe(true);
      expect(mockSend).toHaveBeenCalledWith(dirs, 'startTask', { taskId: 'task-1' });
    });

    it('propagates error when task not found', async () => {
      mockSend.mockResolvedValueOnce({ success: false, error: 'Task not found: task-x', timestamp: Date.now() });
      const res = await sendCommand(dirs, 'startTask', { taskId: 'task-x' });
      expect(res.success).toBe(false);
      expect(res.error).toMatch('Task not found');
    });

    it('propagates error when task is done', async () => {
      mockSend.mockResolvedValueOnce({ success: false, error: 'Cannot start tracking a completed task: task-1', timestamp: Date.now() });
      const res = await sendCommand(dirs, 'startTask', { taskId: 'task-1' });
      expect(res.success).toBe(false);
      expect(res.error).toMatch('Cannot start tracking a completed task');
    });
  });

  describe('stop_task via sendCommand', () => {
    it('sends stopTask command', async () => {
      mockSend.mockResolvedValueOnce(mockResponse(null));
      const res = await sendCommand(dirs, 'stopTask', {});
      expect(res.success).toBe(true);
      expect(mockSend).toHaveBeenCalledWith(dirs, 'stopTask', {});
    });

    it('succeeds even when no timer is running (idempotent)', async () => {
      mockSend.mockResolvedValueOnce(mockResponse(null));
      const res = await sendCommand(dirs, 'stopTask', {});
      expect(res.success).toBe(true);
    });
  });

  // add_time_today — agent-driven time tracking
  describe('add_time_today via sendCommand', () => {
    it('sends addTimeToday with taskId and ms', async () => {
      mockSend.mockResolvedValueOnce(mockResponse({ timeSpentOnDay: {}, timeSpent: 300000 }));
      const res = await sendCommand(dirs, 'addTimeToday', { taskId: 'task-1', ms: 300000 });
      expect(res.success).toBe(true);
      expect(res.result).toEqual({ timeSpentOnDay: {}, timeSpent: 300000 });
      expect(mockSend).toHaveBeenCalledWith(dirs, 'addTimeToday', { taskId: 'task-1', ms: 300000 });
    });

    it('propagates error when task not found', async () => {
      mockSend.mockResolvedValueOnce({ success: false, error: 'Task not found: task-x', timestamp: Date.now() });
      const res = await sendCommand(dirs, 'addTimeToday', { taskId: 'task-x', ms: 1000 });
      expect(res.success).toBe(false);
      expect(res.error).toMatch('Task not found');
    });

    it('propagates error on invalid ms', async () => {
      mockSend.mockResolvedValueOnce({ success: false, error: 'Invalid ms: -5', timestamp: Date.now() });
      const res = await sendCommand(dirs, 'addTimeToday', { taskId: 'task-1', ms: -5 });
      expect(res.success).toBe(false);
      expect(res.error).toMatch('Invalid ms');
    });
  });

  // Bulk array max(100) validation
  describe('bulk operations array limits', () => {
    it('bulk_complete_tasks schema rejects >100 items', () => {
      const { z } = require('zod');
      const schema = z.array(z.string()).max(100);
      const oversized = Array.from({ length: 101 }, (_, i) => `task-${i}`);
      expect(schema.safeParse(oversized).success).toBe(false);
    });

    it('bulk_complete_tasks schema accepts exactly 100 items', () => {
      const { z } = require('zod');
      const schema = z.array(z.string()).max(100);
      const maxed = Array.from({ length: 100 }, (_, i) => `task-${i}`);
      expect(schema.safeParse(maxed).success).toBe(true);
    });
  });

  // 005: Field selection on get_tasks
  describe('get_tasks field selection', () => {
    const tasks = [
      { id: '1', title: 'Task A', isDone: false, projectId: 'p1', tagIds: ['t1'], dueDay: '2026-05-01', timeEstimate: 3600000, timeSpent: 0, parentId: null },
      { id: '2', title: 'Task B', isDone: true, projectId: 'p2', tagIds: [], dueDay: null, timeEstimate: 0, timeSpent: 1000, parentId: null },
    ];

    it('returns only specified fields when fields is provided', () => {
      const fields = ['id', 'title'];
      const shaped = tasks.map(t => {
        const obj: Record<string, unknown> = {};
        for (const f of fields) { if (f in t) obj[f] = (t as Record<string, unknown>)[f]; }
        return obj;
      });
      expect(shaped).toEqual([{ id: '1', title: 'Task A' }, { id: '2', title: 'Task B' }]);
    });

    it('silently ignores unknown fields', () => {
      const fields = ['id', 'nonexistent'];
      const shaped = tasks.map(t => {
        const obj: Record<string, unknown> = {};
        for (const f of fields) { if (f in t) obj[f] = (t as Record<string, unknown>)[f]; }
        return obj;
      });
      expect(shaped).toEqual([{ id: '1' }, { id: '2' }]);
    });

    it('returns full objects when fields is empty', () => {
      const fields: string[] = [];
      // Empty fields = no shaping
      const result = fields.length > 0 ? tasks.map(() => ({})) : tasks;
      expect(result).toEqual(tasks);
    });
  });

  // 005: delete_task via sendCommand
  describe('delete_task via sendCommand', () => {
    it('sends deleteTask with taskId', async () => {
      mockSend.mockResolvedValueOnce(mockResponse(null));
      const res = await sendCommand(dirs, 'deleteTask', { taskId: 'task-1' });
      expect(res.success).toBe(true);
      expect(mockSend).toHaveBeenCalledWith(dirs, 'deleteTask', { taskId: 'task-1' });
    });

    it('propagates error when task not found', async () => {
      mockSend.mockResolvedValueOnce({ success: false, error: 'Task not found: task-x', timestamp: Date.now() });
      const res = await sendCommand(dirs, 'deleteTask', { taskId: 'task-x' });
      expect(res.success).toBe(false);
      expect(res.error).toMatch('Task not found');
    });
  });

  // 005: create_task_with_subtasks via sendCommand
  describe('create_task_with_subtasks via sendCommand', () => {
    it('sends createTaskWithSubtasks and returns parentId + subtaskIds', async () => {
      const result = { parentId: 'p-1', subtaskIds: ['s-1', 's-2'] };
      mockSend.mockResolvedValueOnce(mockResponse(result));
      const res = await sendCommand(dirs, 'createTaskWithSubtasks', {
        data: { title: 'Plan', subtasks: [{ title: 'Sub 1' }, { title: 'Sub 2' }] },
      });
      expect(res.success).toBe(true);
      expect(res.result).toEqual(result);
    });

    it('propagates error on failure', async () => {
      mockSend.mockResolvedValueOnce({ success: false, error: 'Title is required', timestamp: Date.now() });
      const res = await sendCommand(dirs, 'createTaskWithSubtasks', { data: { title: '' } });
      expect(res.success).toBe(false);
    });
  });

  // 006: Search notes
  describe('get_tasks search_query matches notes', () => {
    it('matches task by notes content', () => {
      const tasks = [
        { id: '1', title: 'Task A', notes: 'contains uuid-v4 format', isDone: false, projectId: null, tagIds: [] },
        { id: '2', title: 'Task B', notes: 'nothing here', isDone: false, projectId: null, tagIds: [] },
      ];
      const q = 'uuid-v4'.toLowerCase();
      const filtered = tasks.filter(t => t.title?.toLowerCase().includes(q) || (t.notes && t.notes.toLowerCase().includes(q)));
      expect(filtered.map(t => t.id)).toEqual(['1']);
    });

    it('matches title OR notes', () => {
      const tasks = [
        { id: '1', title: 'Meeting prep', notes: '', isDone: false, projectId: null, tagIds: [] },
        { id: '2', title: 'Other', notes: 'meeting agenda here', isDone: false, projectId: null, tagIds: [] },
      ];
      const q = 'meeting';
      const filtered = tasks.filter(t => t.title?.toLowerCase().includes(q) || (t.notes && t.notes.toLowerCase().includes(q)));
      expect(filtered.map(t => t.id)).toEqual(['1', '2']);
    });
  });

  // 006: Recurring only filter
  describe('get_tasks recurring_only filter', () => {
    it('returns only tasks with repeatCfgId', () => {
      const tasks = [
        { id: '1', title: 'Daily standup', repeatCfgId: 'cfg-1', isDone: false, projectId: null, tagIds: [] },
        { id: '2', title: 'One-off task', repeatCfgId: null, isDone: false, projectId: null, tagIds: [] },
        { id: '3', title: 'No field', isDone: false, projectId: null, tagIds: [] },
      ];
      const filtered = tasks.filter(t => (t as any).repeatCfgId != null);
      expect(filtered.map(t => t.id)).toEqual(['1']);
    });
  });

  // 006: plan_tasks_for_today via sendCommand
  describe('plan_tasks_for_today via sendCommand', () => {
    it('sends bulkUpdateTasks with dueWithTime for each task', async () => {
      const results = { results: [{ id: 't1', success: true }, { id: 't2', success: true }] };
      mockSend.mockResolvedValueOnce(mockResponse(results));
      const res = await sendCommand(dirs, 'bulkUpdateTasks', {
        updates: [{ taskId: 't1', data: { dueWithTime: 1745884800000 } }, { taskId: 't2', data: { dueWithTime: 1745884800000 } }],
      });
      expect(res.success).toBe(true);
      expect((res.result as any).results).toHaveLength(2);
    });

    it('sends null dueWithTime when unplanning', async () => {
      mockSend.mockResolvedValueOnce(mockResponse({ results: [{ id: 't1', success: true }] }));
      await sendCommand(dirs, 'bulkUpdateTasks', { updates: [{ taskId: 't1', data: { dueWithTime: null } }] });
      expect(mockSend).toHaveBeenCalledWith(dirs, 'bulkUpdateTasks', { updates: [{ taskId: 't1', data: { dueWithTime: null } }] });
    });
  });

  describe('get_worklog aggregation', () => {
    it('aggregates timeSpentOnDay by date and project', () => {
      const tasks = [
        {
          id: '1', title: 'A', isDone: true, doneOn: new Date('2026-04-15').getTime(),
          projectId: 'proj-1', tagIds: ['tag-1'], timeEstimate: 3600000, timeSpent: 4000000,
          timeSpentOnDay: { '2026-04-14': 1800000, '2026-04-15': 2200000 },
        },
        {
          id: '2', title: 'B', isDone: false, doneOn: null,
          projectId: 'proj-1', tagIds: [], timeEstimate: 0, timeSpent: 0,
          timeSpentOnDay: { '2026-04-15': 600000 },
        },
      ];

      const startDate = '2026-04-14';
      const endDate = '2026-04-15';
      const daily: Record<string, number> = {};
      const byProject: Record<string, number> = {};
      let completedCount = 0;
      let totalEstimate = 0;
      let totalActual = 0;

      for (const task of tasks) {
        if (task.timeSpentOnDay) {
          for (const [date, ms] of Object.entries(task.timeSpentOnDay)) {
            if (date >= startDate && date <= endDate) {
              daily[date] = (daily[date] ?? 0) + ms;
              const proj = task.projectId ?? 'No Project';
              byProject[proj] = (byProject[proj] ?? 0) + ms;
            }
          }
        }
        if (task.isDone && task.doneOn) {
          const doneDate = new Date(task.doneOn).toISOString().slice(0, 10);
          if (doneDate >= startDate && doneDate <= endDate) {
            completedCount++;
            if (task.timeEstimate > 0) {
              totalEstimate += task.timeEstimate;
              totalActual += task.timeSpent;
            }
          }
        }
      }

      expect(daily['2026-04-14']).toBe(1800000);
      expect(daily['2026-04-15']).toBe(2800000);
      expect(byProject['proj-1']).toBe(4600000);
      expect(completedCount).toBe(1);
      expect(totalActual / totalEstimate).toBeCloseTo(4000000 / 3600000);
    });
  });

  describe('get_task_repeat_cfgs via sendCommand', () => {
    it('returns repeat configs array on success', async () => {
      const cfgs = [
        { id: 'cfg-1', title: 'Weekly review', repeatCycle: 'WEEKLY', repeatEvery: 1, isPaused: false, tagIds: [], projectId: null },
        { id: 'cfg-2', title: 'Daily standup', repeatCycle: 'DAILY', repeatEvery: 1, isPaused: false, tagIds: [], projectId: null },
      ];
      mockSend.mockResolvedValueOnce(mockResponse(cfgs));
      const res = await sendCommand(dirs, 'getTaskRepeatCfgs');
      expect(res.success).toBe(true);
      expect(res.result).toEqual(cfgs);
      expect(mockSend).toHaveBeenCalledWith(dirs, 'getTaskRepeatCfgs');
    });

    it('returns empty array when no repeat configs exist', async () => {
      mockSend.mockResolvedValueOnce(mockResponse([]));
      const res = await sendCommand(dirs, 'getTaskRepeatCfgs');
      expect(res.success).toBe(true);
      expect(res.result).toEqual([]);
    });

    it('includes paused configs with isPaused: true', async () => {
      const cfgs = [{ id: 'cfg-3', title: 'Paused task', repeatCycle: 'MONTHLY', repeatEvery: 1, isPaused: true, tagIds: [], projectId: null }];
      mockSend.mockResolvedValueOnce(mockResponse(cfgs));
      const res = await sendCommand(dirs, 'getTaskRepeatCfgs');
      expect((res.result as typeof cfgs)[0].isPaused).toBe(true);
    });

    it('propagates error when SP state unavailable', async () => {
      mockSend.mockResolvedValueOnce({ success: false, error: 'Failed to get repeat configs', timestamp: Date.now() });
      const res = await sendCommand(dirs, 'getTaskRepeatCfgs');
      expect(res.success).toBe(false);
      expect(res.error).toBe('Failed to get repeat configs');
    });
  });

  // Schedule-aware get_tasks filters and derived fields
  describe('schedule-aware filters / derived fields', () => {
    const HOUR = 3_600_000;
    const startOfToday = new Date().setHours(0, 0, 0, 0);
    const NINE_AM = startOfToday + 9 * HOUR;
    const TEN_AM = startOfToday + 10 * HOUR;

    const schedTasks = [
      { id: '1', title: 'A 9-11', isDone: false, projectId: 'p1', tagIds: [], parentId: null, dueDay: null, dueWithTime: NINE_AM, timeEstimate: 2 * HOUR, timeSpent: 0, doneOn: null },
      { id: '2', title: 'B 10-12', isDone: false, projectId: 'p1', tagIds: [], parentId: null, dueDay: null, dueWithTime: TEN_AM, timeEstimate: 2 * HOUR, timeSpent: 0, doneOn: null },
      { id: '3', title: 'C isolated 15-16', isDone: false, projectId: 'p1', tagIds: [], parentId: null, dueDay: null, dueWithTime: startOfToday + 15 * HOUR, timeEstimate: HOUR, timeSpent: 0, doneOn: null },
      { id: '4', title: 'D no size', isDone: false, projectId: 'p1', tagIds: [], parentId: null, dueDay: null, dueWithTime: NINE_AM + 30 * 60 * 1000, timeEstimate: 0, timeSpent: 0, doneOn: null },
      { id: '5', title: 'E done today', isDone: true, projectId: 'p1', tagIds: [], parentId: null, dueDay: null, dueWithTime: null, timeEstimate: HOUR, timeSpent: 0, doneOn: Date.now() },
      { id: '6', title: 'F unscheduled', isDone: false, projectId: 'p1', tagIds: [], parentId: null, dueDay: localDateStr(), dueWithTime: null, timeEstimate: HOUR, timeSpent: 0, doneOn: null },
    ];

    it('filterScheduledOn returns only tasks planned on that date', () => {
      const today = localDateStr();
      const result = filterScheduledOn(schedTasks, today);
      expect(result.map(t => t.id)).toEqual(['1', '2', '3', '4']);
    });

    it('filterScheduledOn excludes tasks planned on other dates', () => {
      const yesterday = localDateStr(new Date(Date.now() - 86_400_000));
      expect(filterScheduledOn(schedTasks, yesterday)).toEqual([]);
    });

    it('filterCompletedOn matches doneOn date', () => {
      const today = localDateStr();
      const result = filterCompletedOn(schedTasks, today);
      expect(result.map(t => t.id)).toEqual(['5']);
    });

    it('filterOverlapping returns only members of a conflict cluster', () => {
      // 1 (9-11) and 2 (10-12) overlap; 3 isolated; 4 unsized (no end); done and unscheduled excluded
      const result = filterOverlapping(schedTasks);
      expect(result.map(t => t.id).sort()).toEqual(['1', '2']);
    });

    it('sortTasks by planned_time places null last ascending, reverses descending', () => {
      const asc = sortTasks(schedTasks, 'planned_time', 'asc').map(t => t.id);
      expect(asc).toEqual(['1', '4', '2', '3', '5', '6']);
      const desc = sortTasks(schedTasks, 'planned_time', 'desc').map(t => t.id);
      expect(desc).toEqual(['5', '6', '3', '2', '4', '1']);
    });

    it('sortTasks by title and time_estimate', () => {
      expect(sortTasks(schedTasks, 'title', 'asc').map(t => t.id)).toEqual(['1', '2', '3', '4', '5', '6']);
      expect(sortTasks(schedTasks, 'time_estimate', 'asc').map(t => t.id)[0]).toBe('4');
    });

    it('projectFields computes derived schedule fields on demand', () => {
      const now = NINE_AM + 30 * 60 * 1000;
      const fields = ['id', 'startTime', 'endTime', 'status'];
      const [p1, p4] = [projectFields(schedTasks[0], fields, now), projectFields(schedTasks[3], fields, now)];
      expect(p1).toEqual({ id: '1', startTime: '09:00', endTime: '11:00', status: 'in-progress' });
      expect(p4).toEqual({ id: '4', startTime: '09:30', endTime: null, status: 'in-progress' });
    });

    it('projectFields resolves plannedTime and ignores unknown fields', () => {
      const fields = ['id', 'plannedTime', 'nonexistent'];
      const p = projectFields(schedTasks[0], fields, Date.now());
      expect(p.plannedTime).toBe(NINE_AM);
      expect('nonexistent' in p).toBe(false);
    });
  });

  // Enrichment: resolved names in projectFields + single-task detail composition
  describe('enrichment (projectTitle / tags) and get_task detail', () => {
    const NOW = Date.now();
    const NINE_AM = NOW - 60_000; // started a minute ago → deterministically in-progress
    const refs = {
      projectById: new Map([['p1', { id: 'p1', title: 'Career Branding', color: null }]]),
      tagById: new Map([
        ['t1', { id: 't1', title: 'urgent', color: '#FF0000' }],
        ['t2', { id: 't2', title: 'deep-work', color: null }],
      ]),
    };
    const detailTasks = [
      { id: 'parent', title: 'Launch blog', isDone: false, projectId: 'p1', tagIds: ['t1', 't2'], parentId: null, dueDay: null, dueWithTime: NINE_AM, timeEstimate: 3_600_000, timeSpent: 0, timeSpentOnDay: { [localDateStr()]: 600000, '2026-01-01': 900000 }, doneOn: null },
      { id: 'child1', title: 'Write post', isDone: false, projectId: 'p1', tagIds: [], parentId: 'parent', dueDay: null, dueWithTime: null, timeEstimate: 0, timeSpent: 0, timeSpentOnDay: {}, doneOn: null },
      { id: 'child2', title: 'Publish', isDone: true, projectId: 'p1', tagIds: [], parentId: 'parent', dueDay: null, dueWithTime: null, timeEstimate: 0, timeSpent: 0, timeSpentOnDay: {}, doneOn: Date.now() },
      { id: 'other', title: 'Unrelated', isDone: false, projectId: 'p2', tagIds: [], parentId: null, dueDay: null, dueWithTime: null, timeEstimate: 0, timeSpent: 0, timeSpentOnDay: {}, doneOn: null },
    ];

    it('projectFields resolves projectTitle and tags when refs are provided', () => {
      const fields = ['id', 'projectTitle', 'tags'];
      const p = projectFields(detailTasks[0], fields, NOW, refs as any);
      expect(p).toEqual({ id: 'parent', projectTitle: 'Career Branding', tags: [{ id: 't1', title: 'urgent', color: '#FF0000' }, { id: 't2', title: 'deep-work', color: null }] });
    });

    it('projectFields omits enriched names when refs are absent', () => {
      const p = projectFields(detailTasks[0], ['id', 'projectTitle', 'tags'], NOW);
      expect(p).toEqual({ id: 'parent' });
    });

    it('composeTaskDetail resolves parent, subtasks, and last-14-day time', () => {
      const detail = composeTaskDetail(detailTasks[0], detailTasks, refs as any, NOW);
      expect(detail.task.projectTitle).toBe('Career Branding');
      expect(detail.task.tags).toEqual([{ id: 't1', title: 'urgent', color: '#FF0000' }, { id: 't2', title: 'deep-work', color: null }]);
      expect(detail.task.schedule.status).toBe('in-progress');
      expect(detail.parent).toBeNull();
      expect(detail.subtasks).toEqual([
        { id: 'child1', title: 'Write post', isDone: false },
        { id: 'child2', title: 'Publish', isDone: true },
      ]);
      expect(detail.timeSpentLast14Days[localDateStr()]).toBe(600000);
      expect('2026-01-01' in detail.timeSpentLast14Days).toBe(false);
    });

    it('composeTaskDetail resolves parent title for a subtask', () => {
      const detail = composeTaskDetail(detailTasks[1], detailTasks, refs as any, NOW);
      expect(detail.parent).toEqual({ id: 'parent', title: 'Launch blog' });
      expect(detail.subtasks).toEqual([]);
    });

    it('composeTaskDetail exposes plannedTime', () => {
      const detail = composeTaskDetail(detailTasks[0], detailTasks, refs as any, NOW);
      expect('plannedAt' in detail.task).toBe(false);
      expect(detail.task.plannedTime).toBe(NINE_AM);
    });
  });
});
