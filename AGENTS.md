# Agent Instructions

> `CLAUDE.md` is a symlink to this file for Claude Code compatibility.

## Commands

```bash
npm run build        # compile MCP server (tsup) + zip plugin → dist/plugin.zip
npm run dev          # watch mode
npm test             # vitest run
npm run test:watch   # vitest watch
npm run typecheck    # tsc --noEmit (use this, not npx tsc — tsc not in PATH)
npm run lint         # eslint src/
```

## Architecture

Two components communicating via file-based IPC:

- **MCP server** (`src/`) — TypeScript, built with tsup
- **SP plugin** (`plugin/`) — JavaScript + HTML, loaded into Super Productivity

Plugin writes responses to `plugin_responses/`, server reads. Server writes commands to `plugin_commands/`, plugin polls.

```
src/
  ipc/
    command-sender.ts   # sendCommand() — writes command file, polls for response
    directories.ts      # platform-aware IPC dir discovery (macOS/Linux/Windows/snap)
    types.ts            # shared types (TaskFilters, Command, etc.)
  tools/
    tasks.ts            # get_tasks, create_task, update_task, reorder_tasks, timer, plan, …
    projects.ts         # get_projects, create_project, update_project
    tags.ts             # get_tags, create_tag, update_tag
    batch.ts            # batch_update_project (atomic batch, temp_id refs)
    context.ts          # active work context / current-context tasks / selected / focused
    state.ts            # get_app_state, get_notes, get_plugin_config, reinit_data
    counters.ts         # simple counters (get/set/inc/dec/delete/all)
    schedule.ts         # get_schedule (time-blocked view + overlap clusters)
    time.ts             # get_time
    notifications.ts    # show_notification
    diagnostics.ts      # debug tool
    result.ts           # okResult() / errorResult() helpers
  server.ts             # registers all tools
  index.ts              # entry point
plugin/
  plugin.js             # SP plugin — handles all MCP commands, calls PluginAPI
tests/
  unit/tools/           # vitest unit tests (server tools)
  unit/plugin/          # vitest unit tests (plugin logic, e.g. batchTempRefs)
```

## Key Patterns

Tools follow this shape:

```ts
server.registerTool('tool_name', { description, inputSchema }, async (args) => {
  const res = await sendCommand(dirs, 'spAction', { ...args });
  if (!res.success) return errorResult(res.error ?? 'Failed');
  return okResult({ ... });
});
```

SP has no IndexedDB indexes on `tagIds`/`projectId` — filtering is always O(n) and done server-side after `getTasks()`.

## Gotchas

- `npx tsc` pulls a wrong package — always use `npm run typecheck`
- `npm run build` also runs `build:plugin` (zips `plugin/` → `dist/plugin.zip`) — don't run tsup alone
- TypeScript 6 requires `"types": ["node"]` in tsconfig (already set) — removing it breaks all `node:` imports
- Planned time lives in SP's `dueWithTime`, not `plannedAt` (obsolete, always null in current SP). Always read/write `dueWithTime`; responses expose it as `plannedTime`. `update_task`'s canonical param is `due_with_time` (`planned_at` is a deprecated alias).
- Plugin version (manifest.json + `PLUGIN_VERSION` in plugin.js) must stay in sync with package.json — `release.yml` fails a tag if they drift, and `check_connection` surfaces `pluginVersion`.
- `batch_update_project` temp refs: since 1.7.1 the plugin resolves same-batch `temp_id` refs itself (`runBatchUpdateForProject` in plugin/plugin.js — exported for unit tests). Update/delete still need REAL ids (two-phase). A stale plugin (<1.7.1) silently drops temp refs — re-upload `dist/plugin.zip`.
- SP 18.16's chrono parser re-parses date-like `@tokens` in plugin-written titles — `stripResidualDateTokens` (plugin ≥ 1.7.0) neutralizes them; never disable it.

## Specs

For feature specifications and implementation plans, see `specs/` directory.

<!-- SPECKIT START -->
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan
<!-- SPECKIT END -->
