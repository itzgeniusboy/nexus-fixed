import { basename } from "node:path"
import { EOL } from "os"
import { Effect } from "effect"
import { ProjectV2 } from "@nexus-ai/core/project"
import { effectCmd, fail } from "../effect-cmd"
import { cmd } from "./cmd"
import { Project } from "@/project/project"

export type WorkspaceSummary = {
  id: string
  name: string
  vcs: string
  updated: number
  sandboxCount: number
}

function safeWorkspaceName(value: string | undefined): string {
  const normalized = (value ?? "")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  return normalized ? normalized.slice(0, 80) : "(unnamed project)"
}

export function workspaceSummary(project: Project.Info): WorkspaceSummary {
  return {
    id: project.id,
    name: safeWorkspaceName(project.name),
    vcs: project.vcs ?? "none",
    updated: project.time.updated,
    sandboxCount: project.sandboxes.length,
  }
}

export function formatWorkspaceList(projects: Project.Info[], format: "table" | "json"): string {
  const entries = projects
    .map(workspaceSummary)
    .sort((left, right) => right.updated - left.updated || left.name.localeCompare(right.name))

  if (format === "json") return JSON.stringify(entries, null, 2)
  if (entries.length === 0) return "No known local projects. Open a project with NEXUS to add it to the local registry."

  const idWidth = Math.max(10, ...entries.map((entry) => entry.id.length))
  const nameWidth = Math.max(16, ...entries.map((entry) => entry.name.length))
  const header = `Project ID${" ".repeat(idWidth - 10)}  Name${" ".repeat(nameWidth - 4)}  VCS  Sandboxes  Updated`
  const lines = [header, "─".repeat(header.length)]
  for (const entry of entries) {
    lines.push(
      `${entry.id.padEnd(idWidth)}  ${entry.name.padEnd(nameWidth)}  ${entry.vcs.padEnd(4)}  ${String(entry.sandboxCount).padStart(9)}  ${new Date(entry.updated).toISOString()}`,
    )
  }
  return lines.join(EOL)
}

function posixShellLiteral(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`
}

function powerShellLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

/** Returns a copy-only navigation command. It never changes the caller's shell. */
export function workspaceNavigationCommand(directory: string, platform = process.platform): string {
  return platform === "win32"
    ? `Set-Location -LiteralPath ${powerShellLiteral(directory)}`
    : `cd -- ${posixShellLiteral(directory)}`
}

export const WorkspaceListCommand = effectCmd({
  command: "list",
  aliases: ["ls", "$0"],
  describe: "list NEXUS-known local projects using safe metadata only",
  instance: false,
  builder: (yargs) =>
    yargs.option("format", {
      describe: "output format",
      type: "string",
      choices: ["table", "json"],
      default: "table",
    }),
  handler: Effect.fn("Cli.workspace.list")(function* (args: { format?: "table" | "json" }) {
    const projects = yield* Project.Service.use((service) => service.list())
    process.stdout.write(formatWorkspaceList(projects, args.format ?? "table") + EOL)
  }),
})

export const WorkspaceCdCommand = effectCmd({
  command: "cd <projectID>",
  describe: "print a copy-only shell command to navigate to a known local project",
  instance: false,
  builder: (yargs) =>
    yargs.positional("projectID", {
      describe: "project ID from `nexus workspace list`",
      type: "string",
      demandOption: true,
    }),
  handler: Effect.fn("Cli.workspace.cd")(function* (args: { projectID?: string }) {
    if (!args.projectID) return yield* fail("Project ID is required")
    const project = yield* Project.Service.use((service) => service.get(ProjectV2.ID.make(args.projectID)))
    if (!project) return yield* fail(`Known project not found: ${args.projectID}`)

    process.stdout.write(`# ${project.name?.trim() || basename(project.worktree) || "known project"}${EOL}`)
    process.stdout.write(workspaceNavigationCommand(project.worktree) + EOL)
  }),
})

export const WorkspaceCommand = cmd({
  command: "workspace",
  describe: "discover and navigate NEXUS-known local projects without changing them",
  builder: (yargs) => yargs.command(WorkspaceListCommand).command(WorkspaceCdCommand).demandCommand(),
  async handler() {},
})
