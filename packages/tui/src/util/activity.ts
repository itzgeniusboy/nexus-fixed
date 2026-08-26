import type { ToolPart } from "@nexus-ai/sdk/v2"

/**
 * Fixed, redacted narration for a running tool. Labels never interpolate
 * command, path, URL, query, pattern, description, title, or task text so the
 * timeline cannot leak user content while a step is still in flight.
 */
export function activityLabel(part: Pick<ToolPart, "tool">): string {
  switch (part.tool) {
    case "bash":
      return "Running tool…"
    case "read":
      return "Reading…"
    case "edit":
    case "write":
      return "Writing…"
    case "grep":
    case "glob":
      return "Searching…"
    case "webfetch":
      return "Fetching…"
    case "task":
      return "Delegating…"
    default:
      return "Working…"
  }
}
