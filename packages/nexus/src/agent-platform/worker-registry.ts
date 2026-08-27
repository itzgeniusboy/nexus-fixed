import type { AgentCapabilities } from "./capabilities"
import { inspectPublicBrowserPage } from "./browser-handoff"
import { detectProjectTargets, type ProjectTarget } from "./project-targets"
import type { WorkerKind, WorkerRequest, WorkerResult } from "../agent/master"

export type ProjectCheckResult = {
  command: string
  exitCode: number
  output?: string
}

export type GitInspection = {
  branch?: string
  clean?: boolean
  changedFiles?: string[]
  summary: string
}

export type BrowserInspection = {
  url: string
  title?: string
  status?: number
  summary: string
}

export type MasterWorkerOperations = {
  inspectGit?: (input: { workspace: string; signal?: AbortSignal }) => Promise<GitInspection>
  inspectBrowser?: (input: { url: string; signal?: AbortSignal }) => Promise<BrowserInspection>
  runProjectChecks?: (input: {
    workspace: string
    target: ProjectTarget
    commands: readonly string[]
    signal?: AbortSignal
  }) => Promise<readonly ProjectCheckResult[]>
}

export type MasterWorkerContext = {
  capabilities: AgentCapabilities
  operations: MasterWorkerOperations
}

export type MasterWorker = {
  kind: WorkerKind
  run: (request: WorkerRequest, context: MasterWorkerContext) => Promise<WorkerResult>
}

const urlPattern = /https?:\/\/[^\s)\]}>,]+/i

function workerUnavailable(kind: WorkerKind, capabilities: AgentCapabilities): WorkerResult {
  const availability = [
    capabilities.webRuntime ? "web runtime" : undefined,
    capabilities.browserAutomation ? "browser automation" : undefined,
    capabilities.android ? "Android tooling" : undefined,
    capabilities.github ? "GitHub CLI" : undefined,
  ].filter((item): item is string => item !== undefined)
  return {
    summary: `${kind} worker is registered, but no execution adapter is available on this device.`,
    verification: availability.length
      ? [`Detected: ${availability.join(", ")}.`]
      : ["No matching execution capability was detected."],
    next: ["Keep this step checkpointed and register the corresponding safe operation before executing it."],
  }
}

function projectWorker(kind: "web" | "android", allow: (target: ProjectTarget) => boolean): MasterWorker {
  return {
    kind,
    async run(request, context) {
      const target = detectProjectTargets(request.workspace).find((item) => allow(item))
      if (!target) {
        return {
          summary: `No ${kind} project target was detected in the workspace.`,
          verification: ["Project detection completed without executing commands."],
        }
      }

      const commands = [...target.testCommands, ...target.buildCommands]
      if (!context.operations.runProjectChecks || commands.length === 0) {
        return {
          summary: `${kind} target detected; execution adapter is not enabled, so no commands were run.`,
          verification: [
            `Package manager: ${target.packageManager ?? "not applicable"}.`,
            ...commands.map((command) => `Available check: ${command}`),
          ],
          next: [
            "Run only the listed focused checks after the runtime confirms the device profile and project permissions.",
          ],
        }
      }

      const results = await context.operations.runProjectChecks({
        workspace: request.workspace,
        target,
        commands,
        signal: request.signal,
      })
      const failed = results.filter((result) => result.exitCode !== 0)
      return {
        summary:
          failed.length === 0
            ? `${kind} checks completed successfully.`
            : `${kind} checks completed with ${failed.length} failure(s).`,
        verification: results.map((result) => `${result.exitCode === 0 ? "PASS" : "FAIL"}: ${result.command}`),
        next: failed.length
          ? ["Review the bounded command output and repair the first failing check before retrying."]
          : undefined,
      }
    },
  }
}

function gitWorker(): MasterWorker {
  return {
    kind: "git",
    async run(request, context) {
      if (!context.capabilities.git) {
        return { summary: "Git is not available on this device; no repository operation was attempted." }
      }
      if (!context.operations.inspectGit) {
        return {
          summary: "Git is available, but the read-only Git inspection adapter is not enabled; no changes were made.",
          verification: ["Commit, push, pull, issue, and pull-request actions remain approval-gated."],
        }
      }
      const result = await context.operations.inspectGit({ workspace: request.workspace, signal: request.signal })
      return {
        summary: result.summary,
        changedFiles: result.changedFiles,
        verification: [
          result.branch ? `Branch: ${result.branch}` : "Branch: unavailable",
          result.clean === undefined
            ? "Working-tree state: unavailable"
            : `Working tree: ${result.clean ? "clean" : "changed"}`,
          "Only read-only inspection was requested by this worker.",
        ],
        next: context.capabilities.github
          ? ["GitHub CLI is detected; external mutations still require explicit approval."]
          : undefined,
      }
    },
  }
}

function browserWorker(): MasterWorker {
  return {
    kind: "browser",
    async run(request, context) {
      const url = `${request.objective} ${request.step.title}`.match(urlPattern)?.[0]
      if (!url) {
        return {
          summary: "Browser worker needs an explicit http:// or https:// URL before inspection.",
          next: [
            "Provide a URL; login, uploads, personal data, CAPTCHA/2FA, and external submissions remain user-controlled.",
          ],
        }
      }
      if (!context.capabilities.browserHttpInspection || !context.operations.inspectBrowser) {
        return {
          summary:
            "Safe browser HTTP inspection is unavailable; URL handoff remains the only browser action supported here.",
          verification: ["No page was opened, logged into, uploaded to, or submitted."],
          next: ["Use the existing safe browser handoff or enable a supported local inspection adapter."],
        }
      }
      const result = await context.operations.inspectBrowser({ url, signal: request.signal })

      return {
        summary: result.summary,
        verification: [
          `Inspected URL: ${result.url}`,
          ...(result.status === undefined ? [] : [`HTTP status: ${result.status}`]),
          ...(result.title ? [`Title: ${result.title}`] : []),
        ],
      }
    },
  }
}

export function createMasterWorkerRegistry(operations: MasterWorkerOperations = {}) {
  const resolvedOperations: MasterWorkerOperations = {
    ...operations,
    inspectBrowser:
      operations.inspectBrowser ??
      (async ({ url, signal }) => {
        const page = await inspectPublicBrowserPage(url, { signal })
        return {
          url: page.url,
          status: page.status,
          title: page.title,
          summary: `Inspected public page (${page.status})${page.title ? `: ${page.title}` : ""}.`,
        }
      }),
  }
  const workers: MasterWorker[] = [
    { kind: "research", run: async (_request, context) => workerUnavailable("research", context.capabilities) },
    { kind: "coder", run: async (_request, context) => workerUnavailable("coder", context.capabilities) },
    { kind: "reviewer", run: async (_request, context) => workerUnavailable("reviewer", context.capabilities) },
    { kind: "tester", run: async (_request, context) => workerUnavailable("tester", context.capabilities) },
    gitWorker(),
    browserWorker(),
    projectWorker("web", (target) => target.kind === "web" || target.kind === "node"),
    projectWorker("android", (target) => target.kind === "android"),
    { kind: "docs", run: async (_request, context) => workerUnavailable("docs", context.capabilities) },
  ]
  const byKind = new Map(workers.map((worker) => [worker.kind, worker]))
  return {
    list: () => workers.map((worker) => worker.kind),
    get: (kind: WorkerKind) => byKind.get(kind),
    run: async (request: WorkerRequest): Promise<WorkerResult> => {
      const worker = byKind.get(request.step.kind)
      if (!worker) throw new Error(`No Master worker registered for ${request.step.kind}`)
      return worker.run(request, { capabilities: request.capabilities, operations: resolvedOperations })
    },
  }
}

export type MasterWorkerRegistry = ReturnType<typeof createMasterWorkerRegistry>
