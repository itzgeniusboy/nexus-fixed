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

export type WorkspaceDetail = WorkspaceSummary & {
  worktree: string
}

export function validatedWorkspaceDisplayName(value: string | undefined): string | undefined {
  if (!value) return undefined
  if (/[\u0000-\u001f\u007f-\u009f]/.test(value)) return undefined
  const normalized = value.replace(/\s+/g, " ").trim()
  return normalized && normalized.length <= 80 ? normalized : undefined
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

export function workspaceDetail(project: Project.Info): WorkspaceDetail {
  return {
    ...workspaceSummary(project),
    worktree: project.worktree
      .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
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

export function formatWorkspaceDetail(project: Project.Info, format: "table" | "json"): string {
  const detail = workspaceDetail(project)
  if (format === "json") return JSON.stringify(detail, null, 2)
  return [
    `Project ID: ${detail.id}`,
    `Name: ${detail.name}`,
    `VCS: ${detail.vcs}`,
    `Worktree: ${detail.worktree}`,
    `Sandboxes: ${detail.sandboxCount}`,
    `Updated: ${new Date(detail.updated).toISOString()}`,
    "Read-only detail: no project metadata, directory, source file, configuration, or selection state changed.",
  ].join(EOL)
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

export const WorkspaceShowCommand = effectCmd({
  command: "show <projectID>",
  describe: "show explicit safe detail for one known local project without changing it",
  instance: false,
  builder: (yargs) =>
    yargs
      .positional("projectID", {
        describe: "project ID from `nexus workspace list`",
        type: "string",
        demandOption: true,
      })
      .option("format", {
        describe: "output format",
        type: "string",
        choices: ["table", "json"],
        default: "table",
      }),
  handler: Effect.fn("Cli.workspace.show")(function* (args: { projectID?: string; format?: "table" | "json" }) {
    if (!args.projectID) return yield* fail("Project ID is required")
    const project = yield* Project.Service.use((service) => service.get(ProjectV2.ID.make(args.projectID)))
    if (!project) return yield* fail(`Known project not found: ${args.projectID}`)
    process.stdout.write(formatWorkspaceDetail(project, args.format ?? "table") + EOL)
  }),
})

export const WorkspaceRenameCommand = effectCmd({
  command: "rename <projectID>",
  describe: "set a confirmed local display name for one known project; never changes project files",
  instance: false,
  builder: (yargs) =>
    yargs
      .positional("projectID", {
        describe: "project ID from `nexus workspace list`",
        type: "string",
        demandOption: true,
      })
      .option("name", {
        describe: "new local display name (1–80 printable characters)",
        type: "string",
        demandOption: true,
      })
      .option("confirm", {
        describe: "explicitly confirm changing only this local registry display name",
        type: "boolean",
        default: false,
      }),
  handler: Effect.fn("Cli.workspace.rename")(function* (args: {
    projectID?: string
    name?: string
    confirm?: boolean
  }) {
    if (!args.projectID) return yield* fail("Project ID is required")
    const name = validatedWorkspaceDisplayName(args.name)
    if (!name) return yield* fail("--name must contain 1–80 printable characters")
    if (!args.confirm) return yield* fail("Workspace display-name changes require --confirm")
    const updated = yield* Project.Service.use((service) =>
      service.update({ projectID: ProjectV2.ID.make(args.projectID!), name }),
    )
    process.stdout.write(
      `Updated local display name for ${updated.id} to ${JSON.stringify(updated.name)}. No project files, commands, icon, worktree, sandbox, configuration, or selection state changed.${EOL}`,
    )
  }),
})

export const WorkspaceCommand = cmd({
  command: "workspace",
  describe: "discover and navigate NEXUS-known local projects without changing them",
  builder: (yargs) =>
    yargs
      .command(WorkspaceListCommand)
      .command(WorkspaceCdCommand)
      .command(WorkspaceShowCommand)
      .command(WorkspaceRenameCommand)
      .demandCommand(),
  async handler() {},
})
