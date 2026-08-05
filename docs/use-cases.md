# Use Cases

Real prompts you can use with any MCP-compatible AI assistant connected to Super Productivity.

## Quick Capture

> "Add a task: Buy milk #shopping @tomorrow 15m"

Parses tag, due date, and time estimate from short syntax — one shot, no follow-up.

> "Create a task 'Deploy v2.1' in my Work project, due Friday, estimate 2h"

> "Add 'Call dentist' with a note: Ask about insurance coverage"

## Batch Triage

> "Show me all unscheduled tasks in my Work project, tag them #backlog, and set them due next Friday"

> "Find all tasks tagged #urgent that are overdue and move them to today"

> "Mark all subtasks of 'Sprint 12' as complete"

## Planning Sessions

> "Look at my week: show today's plan and anything overdue. Break 'Launch blog' into subtasks, start the first one, and move anything I finished yesterday to done. Give me a time summary when you're done."

> "What's on my plate today? Reorder tasks so the shortest ones come first."

> "Show me all recurring tasks — which ones are overdue?"

## Task Breakdown

> "Break 'Redesign landing page' into subtasks: wireframe, copy, design, implement, review"

> "Create a parent task 'Q3 OKRs' with subtasks for each team goal"

## Atomic Batch Operations

> "Set up next week: create a parent task 'Sprint 13' with 4 subtasks, then order them by priority"

One `batch_update_project` call — the subtasks reference the parent's `temp_id`, and the reorder references the created tasks, all resolved in the same call.

> "In my Work project: create 'Draft proposal', rename it to 'Draft proposal v2', and schedule a review task under it"

If you need to update or delete something you just created, use its real id from the first call's `createdTaskIds` in a second (two-phase) call.

## Counters

> "How many coffees today? Bump the counter by 1"

> "Show me all counters"

> "Reset my standing-desk counter to 0"

## Time Tracking

> "Start tracking 'Write API docs'"

> "What am I currently working on? How long have I been on it?"

> "Stop the timer and show me a summary of today's time"

> "Give me a worklog for this week — how much time per project?"

## Organization

> "Move all Inbox tasks that mention 'design' to the Design project"

> "Tag everything in my Sourcing project with #hiring"

> "Remove the #urgent tag from all completed tasks"

> "Rename 'Old Project' to 'Archive - Old Project'"

## Review & Reporting

> "How many tasks did I complete this week? Show time spent vs. estimated."

> "List all tasks due this week grouped by project"

> "What's overdue? Sort by oldest first."

## Daily Routines

> "Morning standup: show what I did yesterday, what's planned today, and anything blocked (overdue > 3 days)"

> "End of day: stop the timer, show today's worklog, and plan tomorrow's top 3 from my backlog"
