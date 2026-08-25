import { describe, expect, test } from "bun:test"
import {
  formatWorkspaceDetail,
  formatWorkspaceList,
  workspaceNavigationCommand,
  workspaceSummary,
} from "../../src/cli/cmd/workspace"

describe("workspace CLI safety", () => {
  const project = {
    id: "proj_safe",
    worktree: "/private/workspaces/demo project's app",
    name: "Demo app",
    vcs: "git",
    sandboxes: ["/private/workspaces/demo project's app/.sandbox"],
    time: { created: 100, updated: 200 },
  } as any

  test("lists only safe project metadata and omits local directory paths", () => {
    const summary = workspaceSummary(project)
    const table = formatWorkspaceList([project], "table")
    const json = formatWorkspaceList([project], "json")

    expect(summary).toEqual({ id: "proj_safe", name: "Demo app", vcs: "git", updated: 200, sandboxCount: 1 })
    expect(table).toContain("Demo app")
    expect(json).toContain('"sandboxCount": 1')
    expect(table).not.toContain("/private/workspaces")
    expect(json).not.toContain("/private/workspaces")
  })

  test("normalizes control characters in metadata before terminal output", () => {
    const output = formatWorkspaceList([{ ...project, name: "Demo\n\u001b[31mapp" }], "table")

    expect(output).toContain("Demo [31mapp")
    expect(output).not.toContain("\u001b")
    expect(output).not.toContain("\n\u001b[31m")
  })

  test("shows selected project detail explicitly without a mutation claim", () => {
    const table = formatWorkspaceDetail(project, "table")
    const json = formatWorkspaceDetail(project, "json")

    expect(table).toContain("Project ID: proj_safe")
    expect(table).toContain("Worktree: /private/workspaces/demo project's app")
    expect(table).toContain("Read-only detail: no project metadata")
    expect(json).toContain('"worktree": "/private/workspaces/demo project\'s app"')
  })

  test("prints a shell-escaped copy-only navigation command for an explicitly selected project", () => {
    const directory = "/private/workspaces/demo project's app"

    expect(workspaceNavigationCommand(directory, "linux")).toBe(`cd -- '/private/workspaces/demo project'"'"'s app'`)
    expect(workspaceNavigationCommand(directory, "win32")).toBe(
      "Set-Location -LiteralPath '/private/workspaces/demo project''s app'",
    )
  })
})
