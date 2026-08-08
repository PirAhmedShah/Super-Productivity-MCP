import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { okResult } from './result.js';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

const MINUTE_MS = 60_000;

/**
 * Floor a unix-ms timestamp to the start of its whole minute. Scheduling
 * granularity is 1 minute (SP renders HH:mm only — sub-minute times create
 * invisible overlaps), so every planned-time write is normalized down to a
 * whole minute before it reaches SP.
 */
export function minuteFloor(ms: number): number {
  return Math.floor(ms / MINUTE_MS) * MINUTE_MS;
}

/** Current wall-clock context for the agent. Exported for testability. */
export function timePayload(d: Date = new Date()): {
  iso: string;
  epochMs: number;
  localDate: string;
  localTime: string;
  dayOfWeek: string;
  timezone: string;
} {
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    iso: d.toISOString(),
    epochMs: d.getTime(),
    localDate: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    localTime: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
    dayOfWeek: DAY_NAMES[d.getDay()],
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

export function registerTimeTools(server: McpServer): void {
  server.registerTool(
    'get_time',
    {
      description: 'Get the current date/time on the user\'s machine (local timezone). Use this to compute planned times — never run a `date` shell command. epochMs is ready to pass to update_task { due_with_time } (e.g. epochMs = "plan from now until next task").',
      inputSchema: {},
    },
    async () => okResult(timePayload()),
  );
}
