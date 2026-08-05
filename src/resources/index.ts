import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ResolvedDirs } from '../ipc/directories.js';
import { sendCommand } from '../ipc/command-sender.js';
import { applyTriageFilters } from '../tools/tasks.js';
import { buildScheduleView, localDateStr, plannedTimeOf } from '../tools/schedule.js';
import { enrichTask, loadRefs, type EnrichedTask, type Refs } from '../enrich.js';
import { timePayload } from '../tools/time.js';

interface TaskRecord {
  id: string;
  title: string;
  isDone: boolean;
  projectId: string | null;
  parentId?: string | null;
  tagIds: string[];
  dueDay?: string | null;
  dueWithTime?: number | null;
  timeEstimate: number;
  timeSpent: number;
  [key: string]: unknown;
}

/** Lean task shape with project/tag names resolved (keeps context small for resources). */
function shapeTask(t: TaskRecord, refs: Refs): EnrichedTask<{
  id: string;
  title: string;
  projectId: string | null;
  tagIds: string[];
  dueDay: string | null;
  plannedTime: number | null;
  timeEstimate: number;
  timeSpent: number;
  parentId: string | null;
  isDone: boolean;
}> {
  return enrichTask({
    id: t.id,
    title: t.title,
    projectId: t.projectId,
    tagIds: t.tagIds,
    dueDay: t.dueDay ?? null,
    plannedTime: plannedTimeOf(t),
    timeEstimate: t.timeEstimate,
    timeSpent: t.timeSpent,
    parentId: t.parentId ?? null,
    isDone: t.isDone,
  }, refs);
}

export function registerResources(server: McpServer, dirs: ResolvedDirs): void {
  server.registerResource('sp-projects', 'sp://projects', {
    description: 'All Super Productivity projects with IDs and colors',
    mimeType: 'application/json',
  }, async (uri) => {
    const res = await sendCommand(dirs, 'getAllProjects');
    if (!res.success) throw new Error(res.error ?? 'SP not responding');
    const projects = (res.result as Array<Record<string, unknown>>).map(p => ({
      id: p.id,
      title: p.title,
      color: (p.theme as Record<string, unknown>)?.primary ?? null,
    }));
    return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(projects) }] };
  });

  server.registerResource('sp-tags', 'sp://tags', {
    description: 'All Super Productivity tags with IDs, colors, and icons',
    mimeType: 'application/json',
  }, async (uri) => {
    const res = await sendCommand(dirs, 'getAllTags');
    if (!res.success) throw new Error(res.error ?? 'SP not responding');
    const tags = (res.result as Array<Record<string, unknown>>).map(t => ({
      id: t.id,
      title: t.title,
      color: (t.theme as Record<string, unknown>)?.primary ?? t.color ?? null,
      icon: t.icon ?? null,
    }));
    return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(tags) }] };
  });

  server.registerResource('sp-tasks-today', 'sp://tasks/today', {
    description: "Today's planned tasks (with project and tag names resolved)",
    mimeType: 'application/json',
  }, async (uri) => {
    const res = await sendCommand(dirs, 'getTasks', { filters: {} });
    if (!res.success) throw new Error(res.error ?? 'SP not responding');
    const refs = await loadRefs(dirs);
    const tasks = applyTriageFilters(res.result as TaskRecord[], { plannedForToday: true }).filter(t => !t.isDone);
    return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(tasks.map(t => shapeTask(t, refs))) }] };
  });

  server.registerResource('sp-tasks-overdue', 'sp://tasks/overdue', {
    description: 'Overdue tasks (due date strictly before today, with project and tag names resolved)',
    mimeType: 'application/json',
  }, async (uri) => {
    const res = await sendCommand(dirs, 'getTasks', { filters: {} });
    if (!res.success) throw new Error(res.error ?? 'SP not responding');
    const refs = await loadRefs(dirs);
    const tasks = applyTriageFilters(res.result as TaskRecord[], { overdue: true }).filter(t => !t.isDone);
    return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(tasks.map(t => shapeTask(t, refs))) }] };
  });

  // sp://context — one-fetch session bootstrap: everything the agent needs to start a day.
  server.registerResource('sp-context', 'sp://context', {
    description: "Consolidated session context: server time, projects, tags, today's schedule (with overlaps and completed), overdue tasks, and the currently tracked task — all names resolved",
    mimeType: 'application/json',
  }, async (uri) => {
    const today = localDateStr();

    const [projRes, tagRes, curRes, taskRes] = await Promise.all([
      sendCommand(dirs, 'getAllProjects'),
      sendCommand(dirs, 'getAllTags'),
      sendCommand(dirs, 'loadCurrentTask', {}),
      sendCommand(dirs, 'getTasks', { filters: {} }),
    ]);
    if (!taskRes.success) throw new Error(taskRes.error ?? 'SP not responding');

    const refs = await loadRefs(dirs);
    const projects = (projRes.result as Array<Record<string, unknown>>) ?? [];
    const tags = (tagRes.result as Array<Record<string, unknown>>) ?? [];

    const view = await buildScheduleView(dirs, {
      startDate: today,
      endDate: today,
      includeDone: true,
      includeSubtasks: true,
    });
    if (!view.ok) throw new Error(view.error ?? 'SP not responding');

    const overdue = applyTriageFilters(taskRes.result as TaskRecord[], { overdue: true }).filter(t => !t.isDone).map(t => shapeTask(t, refs));
    const currentTask = curRes.success && curRes.result
      ? enrichTask(curRes.result as { id: string; title: string; isDone: boolean; projectId: string | null; parentId?: string | null; tagIds: string[]; dueDay?: string | null }, refs)
      : null;

    const context = {
      serverNow: timePayload(new Date()),
      projects: projects.map(p => ({ id: p.id, title: p.title, color: (p.theme as Record<string, unknown>)?.primary ?? null })),
      tags: tags.map(t => ({ id: t.id, title: t.title, color: (t.theme as Record<string, unknown>)?.primary ?? t.color ?? null, icon: t.icon ?? null })),
      today: view.view,
      overdue,
      currentTask,
    };
    return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(context) }] };
  });
}
