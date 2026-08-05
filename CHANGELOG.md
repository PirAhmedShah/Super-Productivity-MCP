# Changelog

All notable changes to this project are documented here. Format loosely follows [Keep a Changelog](https://keepachangelog.com/); versions align with the SP plugin manifest and the npm package.

## [1.8.0] — 2026-08-05

### Breaking
- **Super Productivity 18.16.0+ only.** The plugin now hard-gates on the app version: on older builds every command except `check_connection` fails with a clear error instead of silently degrading. `minSupVersion` in the manifest is `18.16.0`, and `check_connection` now reports `minSupVersion` alongside `appVersion`.

### Removed (legacy support paths)
- **`planned_at` parameter on `update_task`** — `due_with_time` is the only way to set the planned time.
- **`plannedAt` as a `get_tasks` `fields` alias** — only `plannedTime` (the effective planned timestamp, SP `dueWithTime`) is supported.
- **Legacy `plannedAt` read fallback** in `plannedTimeOf` — `dueWithTime` is the only planned-time source; `plannedAt`-only tasks have no planned time.
- **Marker-only timer fallback** in `start_task`/`stop_task` — the `[Task] SetCurrentTask` dispatch is unconditional; a rejected dispatch now surfaces as an error rather than silently falling back.
- **`getAppState` version-guard workarounds** (the "requires SP from 2026-05-26" messages and the `get_tasks recurring_only` workaround hint) — replaced with a single "requires SP 18.16.0+" error.

## [1.7.3] — 2026-08-05

### Added
- **`update_task` accepts `time_spent_on_day`** — a `{ 'YYYY-MM-DD': ms }` map that merges into the task's per-day bucket (`timeSpentOnDay`, what the worklog sums). Dates not listed are untouched, so it corrects both directions without negative values. `timeSpent` is recomputed as the bucket sum unless `time_spent` is also given. Before this, an over-accrued day was unfixable: `update_task { time_spent }` only zeroed the total and `add_time_today` rejects negative ms. Implemented plugin-side mirroring the `addTimeToday` write path (verified working in production); the merge helper is exported for unit tests (5 new tests).

## [1.7.2] — 2026-08-05

### Fixed
- **`start_task`/`stop_task` now drive SP's real timer (UI ticker + native accrual)** — previously they only wrote a `currentTimestamp` marker, so the Super Productivity UI never showed a running timer and `timeSpentOnDay` was only accruable agent-side. The plugin now also dispatches the whitelisted NgRx action `[Task] SetCurrentTask` (`id` to start, `id: null` to stop; `unsetCurrentTask` is not on the allowed-action whitelist), which starts/stops SP's native ticker. The marker write is kept as a verification signal, and a catch-all falls back to marker-only behaviour on SP builds where the action is rejected. Live-verified against SP 18.16.0.

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
