import { existsSync, readFileSync } from "node:fs"
import { mkdir, rename, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { randomUUID } from "node:crypto"
import type { AgentCapabilities } from "../agent-platform/capabilities"
import { detectAgentCapabilities } from "../agent-platform/capabilities"

export type MasterTaskStatus =
  | "received"
  | "acknowledged"
  | "planning"
  | "awaiting_approval"
  | "dispatching"
  | "running"
  | "verifying"
  | "retrying"
  | "paused"
  | "blocked"
  | "completed"
  | "failed"
  | "cancelled"

export type WorkerKind = "research" | "coder" | "reviewer" | "tester" | "git" | "browser" | "web" | "android" | "docs"

export type MasterStepStatus = Exclude<MasterTaskStatus, "received" | "acknowledged" | "planning" | "paused">

export type MasterStep = {
  id: string
  kind: WorkerKind
  title: string
  status: MasterStepStatus
  dependsOn: string[]
  attempts: number
  maxAttempts: number
  startedAt?: string
  completedAt?: string
  error?: string
  result?: string
}

export type MasterTask = {
  version: 1
  id: string
  objective: string
  status: MasterTaskStatus
  steps: MasterStep[]
  activeStepID?: string
  queuedInstructions: string[]
  retryCount: number
  createdAt: string
  updatedAt: string
  error?: string
}

export type WorkerRequest = {
  taskID: string
  step: MasterStep
  objective: string
  workspace: string
  queuedInstructions: string[]
  capabilities: AgentCapabilities
  signal?: AbortSignal
}

export type WorkerResult = {
  summary: string
  changedFiles?: string[]
  verification?: string[]
  next?: string[]
}

export type MasterHooks = {
  onStatus?: (message: string, task: MasterTask) => void
  onCheckpoint?: (task: MasterTask) => void
}

export type MasterAgentOptions = {
  workspace: string
  statePath?: string
  maxStepAttempts?: number
  hooks?: MasterHooks
}

export function suggestMasterSteps(objective: string): Array<Pick<MasterStep, "id" | "kind" | "title" | "dependsOn">> {
  const normalized = objective.trim().toLowerCase()
  const steps: Array<Pick<MasterStep, "id" | "kind" | "title" | "dependsOn">> = []
  const add = (id: string, kind: WorkerKind, title: string, dependsOn: string[] = []) =>
    steps.push({ id, kind, title, dependsOn })

  if (/research|investigate|analy[sz]e|compare|find out|documentation|docs|reference/.test(normalized)) {
    add("research", "research", "Research the task and constraints")
  }
  if (/browser|website|web page|login|click|scrape|crawl/.test(normalized)) {
    add("browser", "browser", "Inspect or operate the browser task", steps.length ? [steps.at(-1)!.id] : [])
  }
  if (/web app|website|frontend|backend|api|server|deploy/.test(normalized)) {
    add("web", "web", "Run and inspect the web application", steps.length ? [steps.at(-1)!.id] : [])
  }
  if (/android|apk|mobile|gradle|adb|termux/.test(normalized)) {
    add("android", "android", "Build and test the Android target", steps.length ? [steps.at(-1)!.id] : [])
  }
  if (/git|github|commit|branch|pull request|\bpr\b|repository|repo/.test(normalized)) {
    add("git", "git", "Review and prepare the Git/GitHub changes", steps.length ? [steps.at(-1)!.id] : [])
  }
  if (/fix|bug|debug|implement|build|refactor|edit|code|feature|change/.test(normalized) || steps.length === 0) {
    add("coder", "coder", "Implement the required code changes", steps.length ? [steps.at(-1)!.id] : [])
  }
  add("review", "reviewer", "Review the diff and diagnose remaining risks", [steps.at(-1)!.id])
  add("test", "tester", "Run focused verification and regression tests", [steps.at(-1)!.id])
  if (/readme|documentation|docs|guide|release/.test(normalized)) {
    add("docs", "docs", "Update project documentation", [steps.at(-1)!.id])
  }
  return steps
}

const ACTIVE_STATUSES = new Set<MasterTaskStatus>([
  "received",
  "acknowledged",
  "planning",
  "dispatching",
  "running",
  "verifying",
  "retrying",
])
const RISKY_ACTION =
  /(^|\s)(sudo|rm|rmdir|del|format|mkfs|git\s+push|git\s+reset\s+--hard|npm\s+publish|pnpm\s+publish|gradle\s+publish)(\s|$)|password|api[_ -]?key|token|cookie|login|payment|captcha|2fa/i

function now() {
  return new Date().toISOString()
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isMasterTask(value: unknown): value is MasterTask {
  if (!isRecord(value)) return false
  return (
    value.version === 1 &&
    typeof value.id === "string" &&
    typeof value.objective === "string" &&
    Array.isArray(value.steps) &&
    Array.isArray(value.queuedInstructions)
  )
}

export function isRiskyAction(input: string): boolean {
  return RISKY_ACTION.test(input)
}

export function defaultMasterStatePath(workspace: string): string {
  return process.env.NEXUS_MASTER_STATE_PATH || join(workspace, ".nexus", "master-task.json")
}

export class MasterAgent {
  private readonly options: Required<Pick<MasterAgentOptions, "workspace">> & Omit<MasterAgentOptions, "workspace">
  private task?: MasterTask

  constructor(options: MasterAgentOptions) {
    this.options = options
  }

  get current(): MasterTask | undefined {
    return this.task ? clone(this.task) : undefined
  }

  async create(objective: string): Promise<MasterTask> {
    const text = objective.trim()
    if (!text) throw new Error("Master task objective cannot be empty")
    const timestamp = now()
    this.task = {
      version: 1,
      id: `task_${randomUUID()}`,
      objective: text,
      status: "acknowledged",
      steps: [],
      queuedInstructions: [],
      retryCount: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    await this.checkpoint()
    this.status("Got it — Master Agent is planning the task")
    return this.snapshot()
  }

  async resume(): Promise<MasterTask | undefined> {
    const path = this.statePath()
    if (!existsSync(path)) return undefined
    try {
      const parsed: unknown = JSON.parse(readFileSync(path, "utf8"))
      if (!isMasterTask(parsed)) return undefined
      this.task = parsed
      if (ACTIVE_STATUSES.has(parsed.status)) {
        parsed.status = "paused"
        parsed.updatedAt = now()
        await this.checkpoint()
        this.status("Recovered the last Master Agent checkpoint; task is paused safely")
      }
      return this.snapshot()
    } catch {
      return undefined
    }
  }

  async autoPlan(): Promise<MasterTask> {
    const task = this.requireTask()
    return this.plan(suggestMasterSteps(task.objective))
  }

  async plan(steps: Array<Pick<MasterStep, "id" | "kind" | "title" | "dependsOn">>): Promise<MasterTask> {
    const task = this.requireTask()
    task.status = "planning"
    task.steps = steps.map((step) => ({
      ...step,
      status: "dispatching",
      dependsOn: [...step.dependsOn],
      attempts: 0,
      maxAttempts: this.options.maxStepAttempts ?? 2,
    }))
    task.updatedAt = now()
    await this.checkpoint()
    return this.snapshot()
  }

  async enqueueInstruction(instruction: string): Promise<MasterTask> {
    const text = instruction.trim()
    if (!text) return this.snapshot()
    const task = this.requireTask()
    task.queuedInstructions.push(text)
    task.updatedAt = now()
    await this.checkpoint()
    this.status("Queued your instruction; the active step will continue safely")
    return this.snapshot()
  }

  async executePlan(dispatcher: (request: WorkerRequest) => Promise<WorkerResult>): Promise<MasterTask> {
    const task = this.requireTask()
    if (task.steps.length === 0) {
      task.status = "blocked"
      task.error = "Cannot execute a Master plan with no steps"
      await this.checkpoint()
      return this.snapshot()
    }

    while (true) {
      const next = task.steps.find(
        (step) =>
          step.status !== "completed" &&
          step.status !== "failed" &&
          step.dependsOn.every(
            (dependency) => task.steps.find((item) => item.id === dependency)?.status === "completed",
          ),
      )
      if (!next) {
        if (task.steps.some((step) => step.status === "failed")) return this.snapshot()
        if (task.steps.every((step) => step.status === "completed")) return this.snapshot()
        task.status = "blocked"
        task.error = "No executable Master step remains; dependencies may be cyclic or invalid"
        await this.checkpoint()
        return this.snapshot()
      }

      const result = await this.executeStep(next.id, dispatcher)
      if (result.status === "failed" || result.status === "blocked") return result
    }
  }

  async executeStep(stepID: string, worker: (request: WorkerRequest) => Promise<WorkerResult>): Promise<MasterTask> {
    const task = this.requireTask()
    const step = task.steps.find((item) => item.id === stepID)
    if (!step) throw new Error(`Unknown Master Agent step: ${stepID}`)
    if (
      step.dependsOn.some((dependency) => task.steps.find((item) => item.id === dependency)?.status !== "completed")
    ) {
      task.status = "blocked"
      task.error = `Dependencies are incomplete for step ${stepID}`
      await this.checkpoint()
      return this.snapshot()
    }

    task.activeStepID = step.id
    task.status = "running"
    step.status = "running"
    step.startedAt ??= now()
    task.updatedAt = now()
    await this.checkpoint()

    const maxAttempts = Math.max(1, step.maxAttempts)
    while (step.attempts < maxAttempts) {
      step.attempts += 1
      try {
        const result = await worker({
          taskID: task.id,
          step: clone(step),
          objective: task.objective,
          workspace: this.options.workspace,
          queuedInstructions: [...task.queuedInstructions],
          capabilities: detectAgentCapabilities(),
        })
        step.status = "completed"
        step.completedAt = now()
        step.result = result.summary
        task.status = task.steps.every((item) => item.status === "completed") ? "completed" : "dispatching"
        task.activeStepID = undefined
        task.retryCount = 0
        task.updatedAt = now()
        await this.checkpoint()
        return this.snapshot()
      } catch (error) {
        step.error = safeError(error)
        task.retryCount += 1
        task.updatedAt = now()
        if (step.attempts >= maxAttempts) {
          step.status = "failed"
          task.status = "failed"
          task.error = `Step ${step.id} failed after ${step.attempts} attempts: ${step.error}`
          await this.checkpoint()
          return this.snapshot()
        }
        step.status = "retrying"
        task.status = "retrying"
        await this.checkpoint()
        this.status(`Step ${step.id} failed; retrying with bounded recovery`, task)
        step.status = "running"
        task.status = "running"
        await this.checkpoint()
      }
    }

    return this.snapshot()
  }

  async transition(status: MasterTaskStatus, error?: string): Promise<MasterTask> {
    const task = this.requireTask()
    task.status = status
    task.error = error
    task.updatedAt = now()
    await this.checkpoint()
    return this.snapshot()
  }

  async checkpoint(): Promise<void> {
    const task = this.requireTask()
    const path = this.statePath()
    await mkdir(dirname(path), { recursive: true })
    const temporary = `${path}.${process.pid}.tmp`
    await writeFile(temporary, `${JSON.stringify(task, null, 2)}\n`, { encoding: "utf8", mode: 0o600 })
    await rename(temporary, path)
    this.options.hooks?.onCheckpoint?.(this.snapshot())
  }

  private snapshot(): MasterTask {
    return clone(this.requireTask())
  }

  private requireTask(): MasterTask {
    if (!this.task) throw new Error("No active Master Agent task")
    return this.task
  }

  private statePath(): string {
    return this.options.statePath ?? defaultMasterStatePath(this.options.workspace)
  }

  private status(message: string, task = this.task): void {
    if (task) this.options.hooks?.onStatus?.(message, this.snapshot())
  }
}
