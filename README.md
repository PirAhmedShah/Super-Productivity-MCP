<p align="center">
  <img src="plugin/icon.svg" width="128" height="128" alt="SP MCP Bridge icon">
</p>

<h1 align="center">Super Productivity MCP Server</h1>

<p align="center">
An MCP (Model Context Protocol) server that connects AI assistants to <a href="https://super-productivity.com">Super Productivity</a>. Manage tasks, projects, and tags through Claude Desktop, Kiro, or any MCP-compatible client.
</p>

## Why this fork exists

This project is a fork of [b0x42/Super-Productivity-MCP](https://github.com/b0x42/Super-Productivity-MCP), the MCP bridge maintained by the author of Super Productivity. Same MIT base, same install path (SP plugin + MCP server). The fork exists because upstream's toolset covers capture and triage, but not planning.

The author runs his day through an AI assistant: read the schedule in the morning, plan tasks into time blocks, reschedule when the day slips, close out with a review. That loop kept tripping on upstream. Long daily planning sessions, rescheduling mid-day, and managing the schedule itself all required operations upstream did not expose. The fork adds what the agent needed:

- `get_schedule`: time-blocked day view with overlap detection, tasks due but unscheduled, and completed work
- `plan_tasks_for_today` and exact planned times (`due_with_time`): batch a morning plan, or pin a task to a specific clock time
- `sp://context`: one fetch that bootstraps a session (server time, projects, tags, today's schedule, current task)
- real time tracking: `start_task` / `stop_task` drive SP's built-in timer, per-day time buckets, `get_worklog`
- atomic batches: create a parent with subtasks and reorder in one call (temp-id resolution)
- context and state: active view, selected task, `get_app_state` snapshot, counters, notes
- enrichment on every response: resolved `projectTitle` and tags

The fork also commits to one supported target: Super Productivity 18.16.0 and newer. No fallback paths for older versions, 235 passing tests, and every behavior is verified live against 18.16.0. Upstream stays the light option for pure capture; this fork is for running the day.

## First-time setup, step by step

This walks you through a fresh install. If you have installed MCP servers before, skip to [Installation](#installation).

**Step 1: download the plugin**

1. Open the [latest release page](https://github.com/PirAhmedShah/Super-Productivity-MCP/releases/latest) in your browser.
2. Under **Assets**, click **plugin.zip**. If you don't see the file list, click **Show all assets** first. The file downloads to your Downloads folder.
3. Leave the file as is. Do not unzip it. Super Productivity uploads the zip directly.

**Step 2: install the plugin in Super Productivity**

1. Open Super Productivity.
2. Go to **Settings → Plugins → Upload Plugin**.
3. Select the `plugin.zip` you just downloaded and click Open.
4. Restart Super Productivity when it asks you to.

**Step 3: allow Node access**

The first time you start Super Productivity with the plugin enabled, a one-time **Node execution consent dialog** appears. Click **Allow**. The plugin needs it to talk to your assistant. If you re-upload the plugin later, the dialog appears again.

**Step 4: connect your assistant**

The MCP server runs on your computer and is registered in your MCP client. The quickest path is [Claude Desktop: configure your MCP client](#configure-your-mcp-client). It is one small config file: copy the example block, paste it in, and restart the app. Using Kiro or another client? See the same section for config file locations.

**Step 5: verify**

Ask your assistant: "Check the Super Productivity connection." You should get a confirmation that Super Productivity is running and the plugin is responding.

## Prerequisites

- [Super Productivity](https://super-productivity.com) >= 18.16.0 (older builds are refused by the plugin)
- Node.js >= 18
- An MCP-compatible client (Claude Desktop, Kiro, etc.)

## Installation

**First-time users:** the [step-by-step guide above](#first-time-setup-step-by-step) covers the whole flow: download `plugin.zip`, upload it, allow Node access, configure your client, verify.

**Developers:** install the plugin with npx instead of downloading the zip:

```bash
npx -y @pir-ahmed-shah/super-productivity-mcp@latest --extract-plugin
```

This fetches the package and writes `plugin.zip` to the current folder. Upload it in **Settings → Plugins → Upload Plugin**, restart SP, and click **Allow** on the one-time Node execution consent dialog. The plugin requires SP 18.16.0+; older builds are refused with a clear error.

### Configure your MCP client

```json
{
  "mcpServers": {
    "super-productivity": {
      "command": "npx",
      "args": ["-y", "@pir-ahmed-shah/super-productivity-mcp"]
    }
  }
}
```

Config file locations:
- **Claude Desktop (macOS):** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Claude Desktop (Windows):** `%APPDATA%\Claude\claude_desktop_config.json`

For **Claude Code**, don't edit the config file by hand. Use the CLI:

```bash
# user scope (everywhere), project scope (-s project), or local scope (default)
claude mcp add -s user super-productivity npx -- -y @pir-ahmed-shah/super-productivity-mcp
```

To verify, run `claude mcp list`. Restart the session to load the server. Swap `npx -- -y @pir-ahmed-shah/super-productivity-mcp` for `super-productivity-mcp` (global install) or `node /absolute/path/to/dist/index.js` (from source). See [Running without npx](#running-without-npx).

## Running without npx

`npx` is convenient but fetches the package on every cold cache and needs network access. If you'd rather pin a local copy, pick one of the options below.

### Option A: global install

```bash
npm install -g @pir-ahmed-shah/super-productivity-mcp
super-productivity-mcp --extract-plugin   # optional: write plugin.zip to cwd
```

Then point your MCP client at the installed binary:

```json
{
  "mcpServers": {
    "super-productivity": {
      "command": "super-productivity-mcp"
    }
  }
}
```

If the binary isn't found, your MCP client may not inherit your shell's `PATH`. Use the absolute path from `which super-productivity-mcp` as `command`, or if `which` doesn't resolve it, point at `$(npm config get prefix)/bin/super-productivity-mcp` (on macOS/Linux).

### Option B: from source

```bash
git clone https://github.com/PirAhmedShah/Super-Productivity-MCP.git
cd Super-Productivity-MCP
npm install
npm run build              # produces dist/index.js and dist/plugin.zip
```

Then run the server directly with `node`:

```json
{
  "mcpServers": {
    "super-productivity": {
      "command": "node",
      "args": ["/absolute/path/to/Super-Productivity-MCP/dist/index.js"]
    }
  }
}
```

The plugin to upload to Super Productivity is at `dist/plugin.zip` after `npm run build`.

## What you can do

**Quick Capture**
> "Add a task: Buy milk #shopping @tomorrow 15m"

Parses the tag, due date, and time estimate from short syntax. One shot, no follow-up needed.

**Batch Triage**
> "Show me all unscheduled tasks in my Work project, tag them #backlog, and set them due next Friday"

Filters, bulk-updates due dates, and adds tags, all in one conversation turn.

**Full Planning Session**
> "Look at my week: show today's plan and anything overdue. Break 'Launch blog' into subtasks, start the first one, and move anything I finished yesterday to done. Give me a time summary when you're done."

Reads resources for context, creates subtasks in batch, starts the timer, bulk-completes tasks, pulls the worklog, and summarizes. A multi-step workflow in a single prompt.

**Time-Aware Planning**
> "Show me today as a timeline: what overlaps, what's due but unplanned, and what I already finished"

`get_schedule` returns the day as time blocks (start = planned time, size = estimate) with conflict clusters, unscheduled tasks, and completed work in one call. `sp://context` bootstraps a whole session (server time, projects, tags, today's schedule, overdue, current task) in a single read.

See [more use cases](docs/use-cases.md).

## Available tools

| Tool | Description |
|------|-------------|
| `create_task` | Create a task (supports SP short syntax) |
| `create_task_with_subtasks` | Create a parent task + subtasks in one operation |
| `batch_update_project` | Atomic multi-operation batch on one project (create/update/delete/reorder) in a single call. Same-batch `temp_id` references resolve for parents and reorder (plugin ≥ 1.7.1); update/delete need real ids from `createdTaskIds` (see [Atomic batch operations](#atomic-batch-operations)) |
| `get_tasks` | List tasks. Filter by project, tag, done, archived, search (title+notes), `parents_only`, `overdue`, `unscheduled`, `planned_for_today`, `recurring_only`, `scheduled_on`, `completed_on`, `overlapping`, `sort_by`/`sort_dir`, `fields`, `include_schedule`. Full objects expose `plannedTime` (the effective planned timestamp, SP `dueWithTime`). Derived schedule fields (`startTime`, `endTime`, `startMs`, `endMs`, `durationMs`, `status`) are computable via `fields` or `include_schedule` |
| `get_schedule` | Time-blocked view of a date range: tasks sized by `timeEstimate` (duration) and placed by `plannedTime` (start). Returns `scheduled` (with computed start/end/status), `overlaps` (conflict clusters), `unscheduledInRange`, `completedInRange`, and a `summary`. Subtasks are included by default (matching SP's Today view); `include_subtasks: false` opts out and the response then reports hidden tasks via `filteredSubtasks`. All items include resolved `projectTitle` + `tags` |
| `get_task` | Fully-resolved single-task deep-dive: enriched names, derived schedule block, parent title, subtask list, and time spent over the last 14 days |
| `update_task` | Update title, notes, done state, due date, `due_with_time`, time, `time_spent_on_day` (per-day bucket corrections), tags |
| `complete_task` | Mark a task as complete |
| `delete_task` | Permanently delete a task (parent deletes subtasks too) |
| `start_task` | Start the time tracker on a task |
| `stop_task` | Stop the currently running time tracker |
| `add_time_today` | Add elapsed milliseconds to a task's today bucket. Fallback/correction since 1.7.2 (`timeSpentOnDay[today]`, which the worklog sums, plus `timeSpent`). Returns the updated task |
| `get_current_task` | Get the currently tracked task (null if none) |
| `select_task` | Open a task in SP's detail panel (works regardless of the active view) |
| `get_selected_task` | The task currently open in SP's detail panel (null if none) |
| `get_focused_task` | The task row currently focused in the UI (null if none) |
| `get_active_work_context` | The project/tag/TODAY context the user is currently viewing |
| `get_current_context_tasks` | The tasks currently rendered in the active work context |
| `plan_tasks_for_today` | Batch plan/unplan tasks for today (pins to 00:00; `plan_from_now` plans at the current time) |
| `bulk_complete_tasks` | Mark multiple tasks complete in one operation |
| `bulk_update_tasks` | Update multiple tasks in one operation |
| `add_tag_to_task` | Add a tag without replacing other tags |
| `remove_tag_from_task` | Remove a single tag |
| `move_task_to_project` | Move a top-level task to a different project |
| `reorder_tasks` | Reorder tasks within a project or parent |
| `get_projects` | List all projects |
| `create_project` | Create a new project |
| `update_project` | Update project properties |
| `get_tags` | List all tags |
| `create_tag` | Create a new tag |
| `update_tag` | Update tag properties |
| `get_task_repeat_cfgs` | List all recurring task configurations (schedule, cadence, day-of-week settings) |
| `get_worklog` | Time tracking summary for a date range |
| `show_notification` | Show a snackbar in SP's UI |
| `get_time` | Current machine date/time (local tz): `epochMs`, `iso`, `localDate`, `localTime`, `dayOfWeek`, `timezone` |
| `check_connection` | Verify SP is running and the plugin is responding (also returns `serverNow`) |
| `debug_directories` | Show resolved data directory paths |
| `get_app_state` | Read-only full snapshot of SP state (tasks, projects, tags, notes, repeat configs, counters, global config). Optionally written to a JSON file via `output_path` |
| `get_notes` | List all SP notes |
| `get_plugin_config` | The plugin's optional configuration (usually `null`) |
| `reinit_data` | Tell SP to reload its persisted data from disk |
| `get_counter` | Read a simple counter (null if it doesn't exist) |
| `set_counter` | Set a simple counter to an absolute value |
| `increment_counter` | Increment a simple counter (creates it at 0 first) |
| `decrement_counter` | Decrement a simple counter (creates it at 0 first) |
| `delete_counter` | Delete a simple counter |
| `get_all_counters` | Return all simple counters as `{ id: value }` |

## Resources

| Resource | Description |
|----------|-------------|
| `sp://context` | **One-fetch session bootstrap**: server time, projects, tags, today's schedule (with overlaps + completed), overdue tasks, and the currently tracked task. All names resolved |
| `sp://projects` | All projects with IDs and colors |
| `sp://tags` | All tags with IDs, colors, and icons |
| `sp://tasks/today` | Today's planned tasks (names resolved) |
| `sp://tasks/overdue` | Overdue tasks (names resolved) |

## Resolved names

SP stores tasks with opaque `projectId` / `tagIds` UUIDs. To save the agent from joining `get_projects` + `get_tags` by hand, every task payload (from `get_tasks`, `get_schedule`, `get_task`, and the task resources) is enriched with:

- `projectTitle`: the resolved project name (or `null`)
- `tags`: `[{ id, title, color }]` for each of the task's tags

Project/tag lookups are cached server-side (30s TTL) and invalidated automatically on `create/update_tag` and `create/update_project`, so writes are reflected immediately. Unknown references degrade gracefully (resolve to `null` / are omitted). `get_tasks { fields: [...] }` also accepts `projectTitle` and `tags` as selectable fields.

## Atomic batch operations

`batch_update_project` applies create/update/delete/reorder operations to one project in a single call:

- **Same-batch references (plugin ≥ 1.7.1):** give new tasks a `temp_id` and later operations in the *same* call may use it as `parent_id` (subtask under a freshly-created parent), inside `reorder` `task_ids`, or in `sub_task_ids`. The plugin resolves temp ids itself before dispatching to SP.
- **Real ids still required for update/delete:** to update or delete a task you just created in the same batch, run a second call using its real id from the first call's `createdTaskIds` (two-phase pattern).
- On partial failure SP drops skipped operations silently (logged server-side), so verify the result.

## SP short syntax

Include these in task titles and they are parsed automatically:

| Syntax | Example | Effect |
|--------|---------|--------|
| `#tag` | `Buy milk #shopping` | Adds the "shopping" tag |
| `+project` | `Fix bug +work` | Assigns to "work" project (prefix match, min 3 chars) |
| `@due` | `Report @friday` | Sets due date to Friday |
| `@due time` | `Call @tomorrow 3pm` | Sets due date and exact planned time (local) |
| `30m` | `Quick fix 30m` | Sets 30-minute time estimate |
| `1h/2h` | `Research 1h/2h` | Sets 1h spent, 2h estimate |

## Troubleshooting

**Plugin not loading?** Re-upload `plugin.zip` from the [latest release](https://github.com/PirAhmedShah/Super-Productivity-MCP/releases/latest) and accept the Node execution consent dialog that appears on first enable. The plugin requires SP 18.16.0+; older builds are refused by the plugin itself.

**Commands timing out?** Ask *"Show debug info for Super Productivity"* to check that both sides are using the same data directory. Mac App Store users may need to set `SP_MCP_DATA_DIR`.

**Stale plugin?** If tasks behave oddly after plugin writes (mangled titles, dropped subtasks, ignored reorders), the deployed `plugin.zip` is older than the latest release. Re-download it and re-upload in Settings → Plugins.

See the [full troubleshooting guide](docs/troubleshooting.md).

## Scheduling semantics

- A task's planned/start time lives in SP's `dueWithTime` field, exposed as `plannedTime` in responses.
- A task's **size** is its `timeEstimate` (duration) and its **start** is its planned time. `get_schedule` combines the two into a timeline: `startMs = plannedTime`, `endMs = startMs + timeEstimate`.
- `get_schedule` reports **overlap conflict clusters**: transitively-connected groups of tasks whose scheduled windows intersect. Only open tasks with both a planned time and a positive estimate participate; intervals that merely touch at a boundary are not overlaps. `get_tasks { overlapping: true }` returns just the tasks involved in a conflict. Completed tasks land in `completedInRange` only, never double-listed in `scheduled` (with `include_done`), so the summary counts stay consistent.
- Derived per-task `status`: `done` → `unsized` (no planned time) → `past` (now ≥ end) → `in-progress` (now ≥ start) → `upcoming`.
- Get the current wall clock with `get_time` (or `check_connection.serverNow`). `epochMs` is ready for scheduling; do not shell out to `date`.
- **Time tracking:** `start_task` / `stop_task` drive SP's real timer. The plugin dispatches the whitelisted NgRx action `[Task] SetCurrentTask` (`{ id }` to start, `{ id: null }` to stop), so the UI shows the ticking timer and SP accrues `timeSpentOnDay[today]` natively (what `get_worklog` sums). `add_time_today { task_id, ms }` remains as a fallback/correction (retroactive accrual, backgrounded-window under-accrual), and `update_task { time_spent_on_day: { 'YYYY-MM-DD': ms } }` corrects the per-day bucket itself (merge semantics; `timeSpent` follows as the bucket sum).
- `update_task { due_with_time: <unix ms> }` sets the exact planned time (`get_time`'s `epochMs` = "from now until next task"); `null` unplans.
- `plan_tasks_for_today` pins tasks to start-of-day (00:00). Use `plan_from_now: true` when an exact start time matters.
- `@friday 3pm` in a title sets the due date and the exact planned time; `@friday` sets the due date only.
- To verify a write, read the task's `plannedTime` (alias of `dueWithTime`) from the write response or `get_tasks`. The tools return the resulting task so bad input is caught immediately.

## License

MIT
