# Changelog

All notable changes to this project are documented here. Format loosely follows [Keep a Changelog](https://keepachangelog.com/); versions align with the SP plugin manifest and the npm package.

## [1.8.5] — 2026-08-08

### Fixed
- **`batch_update_project` update-op `due_with_time` was a silent no-op on SP 18.16.0** (#14, found live during 1.8.4 verification) — the tool advertised exact-time rescheduling in atomic batches since 1.8.2, but SP's batch engine only copies `title/notes/isDone/parentId/timeEstimate/subTaskIds` onto tasks in update ops and silently drops everything else: `success: true, errors: []` while the planned time never changed. Root cause pinned to SP core (its own `BatchTaskUpdate` type in `packages/plugin-api/src/types.ts` and the whitelist in `task-batch-update.reducer.ts` — no SP core fix possible, so the contract moved). Fix: **two-phase split** — `due_with_time` is never sent into SP's batch payload anymore; it is applied immediately after the batch via the proven `bulkUpdateTasks` path (minute-floored; `null` unplans). The call now reports `plannedTimeApplied`, surfaces follow-up failures under `errors` with a "planned-time follow-up failed" prefix, and **echoes the affected tasks under `tasks`** so one call is fully verifiable. 9 new tests (4 `extractPlannedTimeUpdates` units, 5 handler-flow, 1 integration) — 286 pass; mutation testing: 5/5 new mutants killed (extract rounding, payload leak, dropped follow-up, null guard, helper regression). Related SP-core quirk documented in #14: batch updates do not stamp `modified` (bypasses `task-shared-crud`'s timestamping) — informational only, no MCP impact.

## [1.8.4] — 2026-08-08

### Fixed
- **Sub-minute planned times create invisible overlaps** (#13) — every planned-time write passed `due_with_time` verbatim (`plan_tasks_for_today(plan_from_now)` wrote raw `Date.now()`, carrying seconds+ms), while SP and `get_schedule` render times at HH:mm only. A task planned at 15:45:46.715 with a 45m estimate ended at 16:30:46.715 — a real 41s overlap with the next block at 16:30:05.204 that no rendered time showed. Fix: **minute-normalization at the write boundary** in all four paths — `plan_tasks_for_today` (`plan_from_now`), `update_task`, `bulk_update_tasks`, and `batch_update_project` (`toSpOperation`) now floor `due_with_time` to the whole minute via a shared `minuteFloor` helper (`Math.floor(ms/60000)*60000`); `null` unplan passes through untouched. 1 minute is now the documented smallest scheduling unit (tool schemas + README). `get_time` intentionally stays the raw wall clock — normalization is a write-side guarantee, so agents passing `epochMs` straight through are safe either way. 11 new tests (4 `minuteFloor` unit, 1 batch mapping + 1 updated, 2 `update_task`, 3 `plan_tasks_for_today`, 1 `bulk_update_tasks`) — 277 pass.

## [1.8.3] — 2026-08-06

### Fixed
- **Parents (containers) can never schedule or fake-conflict** (#12) — SP core silently re-aggregates a parent's `timeEstimate` to the sum of its children on ANY child update (even one that touches no estimate), and `bulk_update_tasks`' echo only returned the touched children, so the drift was invisible. Fix, two layers:
  - **Read-side (core):** `get_schedule` / `sp://context` now exclude tasks with `subTaskIds` from `scheduled` (and therefore from overlap clusters) regardless of planned time or mutated estimate; `deriveSchedule` reports containers as always unsized (`hasDuration: false`). A container can no longer render as an N-hour block overlapping its children, no matter what SP writes onto it.
  - **Write-side (hygiene):** `bulk_update_tasks` and `batch_update_project` re-zero `timeEstimate = 0` on unplanned container parents of touched children (one extra getTasks on the existing echo fetch) and include them in the echo / `rezeroedParentIds` — stored data stays consistent with the container model for `get_app_state` snapshots and triage.
- 7 new tests (2 `deriveSchedule`/`isContainer` unit, 3 `get_schedule` handler incl. the mutated-parent regression, 2 `bulk_update_tasks` hygiene) — 266 pass.

## [1.8.2] — 2026-08-05

### Fixed
- **`bulk_update_tasks` now supports the full `update_task` field set** (#10) — the schema omitted `due_with_time`, `is_done`, and `time_spent_on_day`, so batch rescheduling/completion/time-corrections degraded to N sequential `update_task` calls (a 9-task +1h shift cost 9 calls). Server schema + mapping now mirror `update_task` (incl. `doneOn` derivation and bucket-merge semantics).
- **Plugin: `bulkUpdateTasks` now runs the same processing as `updateTask`** — previously a raw passthrough, so bulk silently skipped title short-syntax scrubbing, `time_spent_on_day` merging, and the `dueDay`→`dueWithTime` preservation. Both paths now share one exported `applyTaskUpdate` processor (12 new tests: 8 plugin + 7 handler + 2 integration + 1 batch mapping).
- **`bulk_update_tasks` echoes effective tasks** — after the writes it re-fetches the affected ids (one extra round-trip) and returns `tasks` (id → effective task incl. `plannedTime`) alongside `results`, closing the verification gap that made the agent prefer per-task `update_task` for auditable echoes.
- **`batch_update_project` update-op accepts `due_with_time`** — same gap as `bulk_update_tasks`, now mappable in atomic project batches (null = unplan).

## [1.8.1] — 2026-08-05

### Fixed
- **`get_schedule` now includes subtasks by default** (#9) — previously the default silently dropped every subtask from `scheduled`, `unscheduledInRange`, `completedInRange`, and the summary counts, hiding 8 of 9 planned blocks in the container-parent workflow (SP's own Today/Schedule view shows subtasks). `include_subtasks: false` remains as an explicit opt-out, and the response then reports what was hidden via a new `filteredSubtasks: { count, taskIds } | null` field — filtering can never be silent again. Verified by 6 new handler tests + 1 integration test.
- **`sp://context` includes subtasks in today's schedule** (#11) — the one-fetch session bootstrap hardcoded `includeSubtasks: false`, so the morning snapshot missed subtask plans entirely. Now matches `sp://tasks/today` and SP's Today view (new resource test).

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
