import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/ipc/command-sender.js', () => ({
  sendCommand: vi.fn(),
}));

import { sendCommand } from '../../../src/ipc/command-sender.js';
import { enrichTask, invalidateRefs, loadRefs } from '../../../src/enrich.js';
import type { ResolvedDirs } from '../../../src/ipc/directories.js';
import type { Response } from '../../../src/ipc/types.js';

const mockSend = vi.mocked(sendCommand);
const dirs: ResolvedDirs = { base: '/tmp/enrich-test', commands: '/tmp/enrich-test/pc', responses: '/tmp/enrich-test/pr' };

function ok(result: unknown): Response {
  return { success: true, result, timestamp: Date.now() };
}

const projects = [
  { id: 'proj-1', title: 'Career Branding', theme: { primary: '#2196F3' } },
  { id: 'proj-2', title: 'University' },
];
const tags = [
  { id: 'tag-1', title: 'urgent', theme: { primary: '#FF0000' } },
  { id: 'tag-2', title: 'coding', color: '#00FF00' },
];

describe('loadRefs / invalidateRefs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateRefs(dirs);
  });

  it('builds project/tag lookup maps from getAllProjects + getAllTags', async () => {
    mockSend.mockResolvedValueOnce(ok(projects)).mockResolvedValueOnce(ok(tags));
    const refs = await loadRefs(dirs);
    expect(refs.projectById.get('proj-1')).toEqual({ id: 'proj-1', title: 'Career Branding', color: '#2196F3' });
    expect(refs.projectById.get('proj-2')?.color).toBeNull();
    expect(refs.tagById.get('tag-1')).toEqual({ id: 'tag-1', title: 'urgent', color: '#FF0000' });
    expect(refs.tagById.get('tag-2')?.color).toBe('#00FF00');
    expect(mockSend).toHaveBeenCalledWith(dirs, 'getAllProjects');
    expect(mockSend).toHaveBeenCalledWith(dirs, 'getAllTags');
  });

  it('serves the second call from cache (no refetch within TTL)', async () => {
    mockSend.mockResolvedValueOnce(ok(projects)).mockResolvedValueOnce(ok(tags));
    await loadRefs(dirs);
    await loadRefs(dirs);
    expect(mockSend).toHaveBeenCalledTimes(2); // once per action on first call only
  });

  it('invalidateRefs forces a refetch', async () => {
    mockSend.mockResolvedValueOnce(ok(projects)).mockResolvedValueOnce(ok(tags));
    await loadRefs(dirs);
    invalidateRefs(dirs);
    mockSend.mockResolvedValueOnce(ok(projects)).mockResolvedValueOnce(ok(tags));
    await loadRefs(dirs);
    expect(mockSend).toHaveBeenCalledTimes(4);
  });

  it('degrades gracefully when a fetch fails', async () => {
    mockSend.mockResolvedValueOnce({ success: false, error: 'SP not responding', timestamp: Date.now() }).mockResolvedValueOnce(ok(tags));
    const refs = await loadRefs(dirs);
    expect(refs.projectById.size).toBe(0);
    expect(refs.tagById.size).toBe(2);
  });
});

describe('enrichTask', () => {
  it('adds projectTitle and resolved tags while preserving raw ids', () => {
    const refs = { projectById: new Map([['proj-1', { id: 'proj-1', title: 'Career Branding', color: null }]]), tagById: new Map([['tag-1', { id: 'tag-1', title: 'urgent', color: '#FF0000' }]]) };
    const task = { id: 't1', title: 'Write proposal', projectId: 'proj-1', tagIds: ['tag-1', 'ghost-tag'] };
    const enriched = enrichTask(task, refs);
    expect(enriched.projectTitle).toBe('Career Branding');
    expect(enriched.tags).toEqual([{ id: 'tag-1', title: 'urgent', color: '#FF0000' }]);
    expect(enriched.projectId).toBe('proj-1');
    expect(enriched.tagIds).toEqual(['tag-1', 'ghost-tag']);
    expect(task).toEqual({ id: 't1', title: 'Write proposal', projectId: 'proj-1', tagIds: ['tag-1', 'ghost-tag'] });
  });

  it('resolves null project to null title', () => {
    const refs = { projectById: new Map(), tagById: new Map() };
    const enriched = enrichTask({ id: 't1', projectId: null, tagIds: [] }, refs);
    expect(enriched.projectTitle).toBeNull();
    expect(enriched.tags).toEqual([]);
  });

  it('handles unknown project id gracefully', () => {
    const refs = { projectById: new Map(), tagById: new Map() };
    const enriched = enrichTask({ id: 't1', projectId: 'nope', tagIds: [] }, refs);
    expect(enriched.projectTitle).toBeNull();
  });
});
