import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ResolvedDirs } from '../ipc/directories.js';
import { sendCommand } from '../ipc/command-sender.js';
import { enrichTask, loadRefs, type EnrichedTaskFields } from '../enrich.js';
import { errorResult, okResult } from './result.js';
import { timePayload } from './time.js';

// Structural task shape — deliberately decoupled from tasks.ts's TaskRecord so
// schedule.ts can be imported by tasks.ts without an import cycle.
export interface SchedulableTask {
  id: string;
  title: string;
  isDone: boolean;
  projectId?: string | null;
  parentId?: string | null;
  tagIds?: string[];
  notes?: string;
  dueDay?: string | null;
  dueWithTime?: number | null;
  timeEstimate?: number;
  timeSpent?: number;
  doneOn?: number | null;
  [key: string]: unknown;
}

/** Compute local YYYY-MM-DD date string (not UTC — spec requires local timezone boundary). */
export function localDateStr(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Effective "planned at" timestamp of a task — SP stores it in `dueWithTime`.
 */
export function plannedTimeOf(t: SchedulableTask): number | null {
  return t.dueWithTime ?? null;
}

export type ScheduleStatus = 'done' | 'in-progress' | 'past' | 'upcoming' | 'unsized';

/** Derived schedule of a task: start = planned time, size = time estimate. */
export interface ScheduleBlock {
  startMs: number | null;
  endMs: number | null;
  startTime: string | null;
  endTime: string | null;
  durationMs: number | null;
  hasDuration: boolean;
  status: ScheduleStatus;
}

export interface SchedulableItem extends ScheduleBlock {
  taskId: string;
  title: string;
  projectId: string | null;
  parentId: string | null;
  tagIds: string[];
  dueDay: string | null;
  isDone: boolean;
  doneOn: number | null;
}

export type EnrichedSchedulableItem = SchedulableItem & EnrichedTaskFields;

/** Overlap cluster: a transitively-connected group of scheduled tasks sharing a busy window. */
export interface OverlapCluster {
  taskIds: string[];
  fromMs: number;
  toMs: number;
  fromTime: string;
  toTime: string;
  count: number;
}

function fmtTime(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * Derive a task's schedule block: start = plannedTime, end = start + timeEstimate (only when
 * the estimate is positive — unknown duration can't be sized), plus a planner-friendly status.
 */
export function deriveSchedule(t: SchedulableTask, now: number): ScheduleBlock {
  const startMs = plannedTimeOf(t);
  const est = typeof t.timeEstimate === 'number' && t.timeEstimate > 0 ? t.timeEstimate : null;
  const endMs = startMs != null && est != null ? startMs + est : null;
  let status: ScheduleStatus;
  if (t.isDone) status = 'done';
  else if (startMs == null) status = 'unsized';
  else if (endMs != null && now >= endMs) status = 'past';
  else if (now >= startMs) status = 'in-progress';
  else status = 'upcoming';
  return {
    startMs,
    endMs,
    startTime: startMs != null ? fmtTime(startMs) : null,
    endTime: endMs != null ? fmtTime(endMs) : null,
    durationMs: est,
    hasDuration: est != null,
    status,
  };
}

type OverlapInput = Pick<SchedulableItem, 'taskId' | 'startMs' | 'endMs'>;

/**
 * Find overlapping "conflict clusters" among scheduled tasks. Only tasks with both a planned
 * time and a positive estimate participate (unknown size can't overlap). Intervals that merely
 * touch at a boundary do NOT overlap. A sorted sweep merges transitively-connected intervals
 * into clusters, so A[9-10], B[9:30-9:40], C[9:35-10:30] form one cluster, not three pairs.
 */
export function findOverlaps(items: OverlapInput[]): OverlapCluster[] {
  const sized = items
    .filter(i => i.startMs != null && i.endMs != null)
    .sort((a, b) => (a.startMs as number) - (b.startMs as number));
  const clusters: Array<{ taskIds: string[]; fromMs: number; toMs: number; count: number }> = [];
  for (const item of sized) {
    const start = item.startMs as number;
    const end = item.endMs as number;
    const last = clusters[clusters.length - 1];
    if (last && start < last.toMs) {
      last.taskIds.push(item.taskId);
      last.toMs = Math.max(last.toMs, end);
      last.count += 1;
    } else {
      clusters.push({ taskIds: [item.taskId], fromMs: start, toMs: end, count: 1 });
    }
  }
  return clusters
    .filter(c => c.count > 1)
    .map(c => ({ ...c, fromTime: fmtTime(c.fromMs), toTime: fmtTime(c.toMs) }));
}

function scheduleItem(t: SchedulableTask, now: number): SchedulableItem {
  return {
    taskId: t.id,
    title: t.title,
    projectId: t.projectId ?? null,
    parentId: t.parentId ?? null,
    tagIds: t.tagIds ?? [],
    dueDay: t.dueDay ?? null,
    isDone: t.isDone,
    doneOn: t.doneOn ?? null,
    ...deriveSchedule(t, now),
  };
}

export interface ScheduleSummary {
  scheduledCount: number;
  overlapCount: number;
  overlappingTaskCount: number;
  totalDurationMs: number;
  unscheduledCount: number;
  completedCount: number;
}

export interface ScheduleView {
  scheduled: EnrichedSchedulableItem[];
  overlaps: OverlapCluster[];
  unscheduledInRange: EnrichedSchedulableItem[];
  completedInRange: EnrichedSchedulableItem[];
  summary: ScheduleSummary;
}

export interface ScheduleViewOptions {
  startDate: string;
  endDate: string;
  includeDone: boolean;
  includeSubtasks: boolean;
}

/**
 * Build the time-blocked schedule view for a date range, with project/tag names resolved.
 * Shared by the get_schedule tool and the sp://context resource. Exported for reuse.
 */
export async function buildScheduleView(dirs: ResolvedDirs, opts: ScheduleViewOptions): Promise<{ ok: true; view: ScheduleView } | { ok: false; error: string }> {
  const { startDate, endDate, includeDone, includeSubtasks } = opts;
  const res = await sendCommand(dirs, 'getTasks', { filters: { includeDone } });
  if (!res.success) return { ok: false, error: res.error ?? 'Failed to get tasks' };

  const tasks = (res.result as SchedulableTask[]) ?? [];
  const now = Date.now();

  const scheduled: SchedulableItem[] = [];
  const unscheduledInRange: SchedulableItem[] = [];
  const completedInRange: SchedulableItem[] = [];

  for (const t of tasks) {
    if (t.parentId && !includeSubtasks) continue;
    if (t.isDone) {
      if (!includeDone) continue;
      if (t.doneOn != null) {
        const doneDay = localDateStr(new Date(t.doneOn));
        if (doneDay >= startDate && doneDay <= endDate) completedInRange.push(scheduleItem(t, now));
      }
      continue;
    }
    const start = plannedTimeOf(t);
    if (start != null) {
      const startDay = localDateStr(new Date(start));
      if (startDay >= startDate && startDay <= endDate) scheduled.push(scheduleItem(t, now));
    } else if (t.dueDay && t.dueDay >= startDate && t.dueDay <= endDate) {
      unscheduledInRange.push(scheduleItem(t, now));
    }
  }

  // Conflicts are about active planning — exclude completed tasks from overlap clusters.
  const overlaps = findOverlaps(scheduled.filter(s => !s.isDone));
  const overlappingTaskIds = new Set(overlaps.flatMap(o => o.taskIds));
  const summary: ScheduleSummary = {
    scheduledCount: scheduled.length,
    overlapCount: overlaps.length,
    overlappingTaskCount: overlappingTaskIds.size,
    totalDurationMs: scheduled.reduce((sum, s) => sum + (s.durationMs ?? 0), 0),
    unscheduledCount: unscheduledInRange.length,
    completedCount: completedInRange.length,
  };

  const refs = await loadRefs(dirs);
  const enrich = (list: SchedulableItem[]): EnrichedSchedulableItem[] => list.map(item => enrichTask(item, refs));

  return {
    ok: true,
    view: {
      scheduled: enrich(scheduled),
      overlaps,
      unscheduledInRange: enrich(unscheduledInRange),
      completedInRange: enrich(completedInRange),
      summary,
    },
  };
}

export function registerScheduleTools(server: McpServer, dirs: ResolvedDirs): void {
  server.registerTool(
    'get_schedule',
    {
      description:
        "Get a time-blocked view of tasks for a date range. Each task's size is its time estimate (timeEstimate = duration) and its start is the planned time (plannedTime/dueWithTime). Returns scheduled tasks with computed start/end/status and resolved projectTitle + tags, overlapping 'conflict clusters' (transitively-overlapping groups of open tasks), tasks due-but-unscheduled in the range, and tasks completed in the range. Only tasks with both a planned time and a positive estimate participate in overlap detection; intervals that merely touch are not overlaps.",
      inputSchema: {
        start_date: z.string().optional().describe('Start date (YYYY-MM-DD, local). Defaults to today.'),
        end_date: z.string().optional().describe('End date (YYYY-MM-DD, local). Defaults to start_date.'),
        include_done: z.boolean().optional().default(false).describe('Include completed tasks in the schedule view'),
        include_subtasks: z.boolean().optional().default(false).describe('Include subtasks in the schedule/overlap analysis (top-level tasks only by default)'),
      },
    },
    async ({ start_date, end_date, include_done, include_subtasks }) => {
      const startDate = start_date ?? localDateStr();
      const endDate = end_date ?? startDate;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
        return errorResult('start_date and end_date must be YYYY-MM-DD');
      }
      if (startDate > endDate) return errorResult('start_date must not be after end_date');

      const built = await buildScheduleView(dirs, { startDate, endDate, includeDone: include_done ?? false, includeSubtasks: include_subtasks ?? false });
      if (!built.ok) return errorResult(built.error);

      return okResult({
        startDate,
        endDate,
        generatedAt: timePayload(new Date(Date.now())),
        ...built.view,
      });
    },
  );
}
