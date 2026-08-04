import type { ResolvedDirs } from './ipc/directories.js';
import { sendCommand } from './ipc/command-sender.js';

// Name resolution layer: SP exposes projectId/tagIds as opaque UUIDs, but the agent's
// taxonomy (and the user) refer to projects and tags by their titles. This module fetches
// the lookup tables once (with a short TTL) and enriches task payloads with resolved names
// so the agent never has to join get_projects/get_tags by hand.

export interface RefTag {
  id: string;
  title: string;
  color: string | null;
}

export interface RefProject {
  id: string;
  title: string;
  color: string | null;
}

export interface Refs {
  projectById: Map<string, RefProject>;
  tagById: Map<string, RefTag>;
}

export interface EnrichedTaskFields {
  projectTitle: string | null;
  tags: Array<{ id: string; title: string; color: string | null }>;
}

export type EnrichedTask<T> = T & EnrichedTaskFields;

interface Enrichable {
  projectId?: string | null;
  tagIds?: string[];
}

const REFS_TTL_MS = 30_000;
const cache = new Map<string, { refs: Refs; fetchedAt: number }>();

/** Drop cached project/tag lookups so the next read picks up fresh data (call after writes). */
export function invalidateRefs(dirs: ResolvedDirs): void {
  cache.delete(dirs.base);
}

/**
 * Fetch and cache the project/tag lookup tables. Degrades gracefully: if a fetch fails,
 * that table is simply left empty so read tools still work (just without resolved names).
 */
export async function loadRefs(dirs: ResolvedDirs): Promise<Refs> {
  const hit = cache.get(dirs.base);
  if (hit && Date.now() - hit.fetchedAt < REFS_TTL_MS) return hit.refs;

  const [projRes, tagRes] = await Promise.all([
    sendCommand(dirs, 'getAllProjects'),
    sendCommand(dirs, 'getAllTags'),
  ]);

  const projectById = new Map<string, RefProject>();
  const tagById = new Map<string, RefTag>();

  if (projRes.success) {
    for (const p of (projRes.result as Array<Record<string, unknown>>) ?? []) {
      if (typeof p.id !== 'string') continue;
      projectById.set(p.id, {
        id: p.id,
        title: String(p.title ?? ''),
        color: ((p.theme as Record<string, unknown> | undefined)?.primary as string | undefined) ?? null,
      });
    }
  }
  if (tagRes.success) {
    for (const t of (tagRes.result as Array<Record<string, unknown>>) ?? []) {
      if (typeof t.id !== 'string') continue;
      tagById.set(t.id, {
        id: t.id,
        title: String(t.title ?? ''),
        color: ((t.theme as Record<string, unknown> | undefined)?.primary as string | undefined) ?? (t.color as string | undefined) ?? null,
      });
    }
  }

  const refs: Refs = { projectById, tagById };
  cache.set(dirs.base, { refs, fetchedAt: Date.now() });
  return refs;
}

/**
 * Resolve a task's projectId/tagIds into human-readable names. Returns a copy; raw IDs are
 * preserved. Unknown or missing references resolve to null / are omitted (graceful).
 */
export function enrichTask<T extends Enrichable>(t: T, refs: Refs): EnrichedTask<T> {
  const proj = t.projectId != null ? refs.projectById.get(t.projectId) : undefined;
  const tags = (t.tagIds ?? [])
    .map(id => refs.tagById.get(id))
    .filter((tg): tg is RefTag => tg != null)
    .map(tg => ({ id: tg.id, title: tg.title, color: tg.color }));
  return { ...t, projectTitle: proj?.title ?? null, tags };
}
