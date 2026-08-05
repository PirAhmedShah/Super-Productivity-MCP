# Changelog

All notable changes to this project are documented here. Format loosely follows [Keep a Changelog](https://keepachangelog.com/); versions align with the SP plugin manifest and the npm package.

## [1.7.1] — 2026-08-05

### Fixed
- **`batch_update_project` same-batch temp_id references** — SP 18.16's plugin bridge silently dropped tasks created with `parent_id` = a same-batch `temp_id` (subtask reported in `createdTaskIds` but never persisted) and no-op'd reorders containing temp ids. The plugin now resolves temp refs itself before dispatching: creates run first in dependency order (multi-level chains included), then reorder/update/delete ops are rewritten with real ids. Unresolvable temp parents (e.g. cycles) surface as errors instead of vanishing. Live-verified against SP 18.16.0; 9 new unit tests (`tests/unit/plugin/batchTempRefs.test.ts`).

## [1.7.0] — 2026-08-05

### Added
- `batch_update_project` — atomic multi-operation batch (create/update/delete/reorder) on one project in a single transaction, with `temp_id` referencing (see 1.7.1 for the temp-ref resolution).
- `get_app_state` — read-only full snapshot (tasks, projects, tags, notes, task repeat configs, counters, credential-free global config), optionally persisted via `output_path`.
- Work-context & UI tools — `get_active_work_context`, `get_current_context_tasks`, `get_selected_task`, `get_focused_task`, `select_task`.
- Simple counters — `get_counter`, `set_counter`, `increment_counter`, `decrement_counter`, `delete_counter`, `get_all_counters`.
- `get_notes`, `get_plugin_config`, `reinit_data`.
- Plugin: SP 18.16 API cases (batch, app-state, context/selection, counters), `onUnload` cleanup.

### Fixed
- **SP 18.16 short-syntax clobbering** — SP's own chrono-based parser re-parses date-like `@tokens` left in plugin-created titles, mangling them and clobbering due dates. The plugin now strips residual date tokens (`stripResidualDateTokens`) while preserving non-date tokens (`@dave`, `@tag`).

## [1.6.0] — 2026-08-05

### Fixed
- `@date` short syntax skips non-date `@tokens`; `get_task_repeat_cfgs` falls back gracefully when `getAppState` is unavailable.

## [1.5.2] — 2026-08-04

### Fixed
- Exclude done tasks from `get_schedule`'s scheduled list (no double-counting in the summary); added handler & protocol test coverage.

## [1.5.1] — 2026-08-04

### Added
- Schedule awareness — `get_schedule` (time-blocked day view with overlaps, due-but-unscheduled, and completed-in-range).
- Task name enrichment — responses resolve `projectTitle` + `tags`; `sp://context` one-fetch session bootstrap resource.
- Fixed the `completed_on` filter.

## [1.3.6] — 2026-08-03

### Added
- `get_time` tool (current machine time in the local timezone, `epochMs` ready for scheduling); `check_connection` returns `serverNow` — agents no longer shell out to `date`.
- `@due time` short syntax (`@tomorrow 3pm`) sets the exact planned time; due-day changes preserve it.
- `update_task` `due_with_time` (exact planned time in epoch ms) and `plan_tasks_for_today` `plan_from_now`.

### Changed
- Canonical planned-time field moved to SP's `dueWithTime` (the legacy `plannedAt` is obsolete and always null in current SP); responses expose it as `plannedTime` (`planned_at` is a deprecated alias).

## [1.0.0 – 1.3.5] — earlier releases

Initial MCP server + plugin (task/tag/project CRUD, short syntax parsing, IPC bridge), task/tag triage tools, timer & Today-view bulk tools, MCP resources, `add_time_today` agent-driven time tracking, diagnostics, install/consent-dialog fixes.
