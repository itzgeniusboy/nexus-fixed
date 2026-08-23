import { cmd } from "./cmd"
import * as prompts from "@clack/prompts"
import { UI } from "../ui"
import { Global } from "@nexus-ai/core/global"
import path from "path"
import fs from "fs/promises"
import { Filesystem } from "@/util/filesystem"
import matter from "gray-matter"
import { EOL } from "os"
import type { Argv } from "yargs"
import { Effect } from "effect"
import { effectCmd } from "../effect-cmd"
import { AgentPlatformStore, type LearningStatus, type MemoryKind, type MemoryScope } from "../../agent-platform/store"

type AgentMode = "all" | "primary" | "subagent"

// Permission keys (not raw tool names). Multiple tools can map to a single
// permission — e.g. write/edit/apply_patch all gate on `edit` — so we configure
// agents at the permission level to match how the runtime actually enforces it.
const AVAILABLE_PERMISSIONS = [
  "bash",
  "read",
  "edit",
  "glob",
  "grep",
  "webfetch",
  "task",
  "todowrite",
  "websearch",
  "lsp",
  "skill",
]

const AgentCreateCommand = effectCmd({
  command: "create",
  describe: "create a new agent",
  builder: (yargs: Argv) =>
    yargs
      .option("path", {
        type: "string",
        describe: "directory path to generate the agent file",
      })
      .option("description", {
        type: "string",
        describe: "what the agent should do",
      })
      .option("mode", {
        type: "string",
        describe: "agent mode",
        choices: ["all", "primary", "subagent"] as const,
      })
      .option("permissions", {
        type: "string",
        alias: ["tools"],
        describe: `comma-separated list of permissions to allow (default: all). Available: "${AVAILABLE_PERMISSIONS.join(", ")}"`,
      })
      .option("model", {
        type: "string",
        alias: ["m"],
        describe: "model to use in the format of provider/model",
      }),
  handler: Effect.fn("Cli.agent.create")(function* (args) {
    const { InstanceRef } = yield* Effect.promise(() => import("@/effect/instance-ref"))
    const { Agent } = yield* Effect.promise(() => import("../../agent/agent"))
    const { Provider } = yield* Effect.promise(() => import("@/provider/provider"))
    const maybeCtx = yield* InstanceRef
    if (!maybeCtx) return yield* Effect.die("InstanceRef not provided")
    const ctx = maybeCtx
    const agentSvc = yield* Agent.Service
    const runLocalEffect = <A, E>(effect: Effect.Effect<A, E>) =>
      Effect.runPromise(effect.pipe(Effect.provideService(InstanceRef, ctx)))
    yield* Effect.promise(async () => {
      const cliPath = args.path
      const cliDescription = args.description
      const cliMode = args.mode as AgentMode | undefined
      const perms = args.permissions

      const isFullyNonInteractive = cliPath && cliDescription && cliMode && perms !== undefined

      if (!isFullyNonInteractive) {
        UI.empty()
        prompts.intro("Create agent")
      }

      const project = ctx.project

      // Determine scope/path
      let targetPath: string
      if (cliPath) {
        targetPath = path.join(cliPath, "agents")
      } else {
        let scope: "global" | "project" = "global"
        if (project.vcs === "git") {
          const scopeResult = await prompts.select({
            message: "Location",
            options: [
              {
                label: "Current project",
                value: "project" as const,
                hint: ctx.worktree,
              },
              {
                label: "Global",
                value: "global" as const,
                hint: Global.Path.config,
              },
            ],
          })
          if (prompts.isCancel(scopeResult)) throw new UI.CancelledError()
          scope = scopeResult
        }
        targetPath = path.join(scope === "global" ? Global.Path.config : path.join(ctx.worktree, ".nexus"), "agents")
      }

      // Get description
      let description: string
      if (cliDescription) {
        description = cliDescription
      } else {
        const query = await prompts.text({
          message: "Description",
          placeholder: "What should this agent do?",
          validate: (x) => (x && x.length > 0 ? undefined : "Required"),
        })
        if (prompts.isCancel(query)) throw new UI.CancelledError()
        description = query
      }

      // Generate agent
      const spinner = prompts.spinner()
      spinner.start("Generating agent configuration...")
      const model = args.model ? Provider.parseModel(args.model) : undefined
      const generated = await runLocalEffect(agentSvc.generate({ description, model })).catch((error) => {
        spinner.stop(`LLM failed to generate agent: ${error.message}`, 1)
        if (isFullyNonInteractive) process.exit(1)
        throw new UI.CancelledError()
      })
      spinner.stop(`Agent ${generated.identifier} generated`)

      // Select permissions to allow
      let selected: string[]
      if (perms !== undefined) {
        selected = perms ? perms.split(",").map((t) => t.trim()) : AVAILABLE_PERMISSIONS
      } else {
        const result = await prompts.multiselect({
          message: "Select permissions to allow (Space to toggle)",
          options: AVAILABLE_PERMISSIONS.map((permission) => ({
            label: permission,
            value: permission,
          })),
          initialValues: AVAILABLE_PERMISSIONS,
        })
        if (prompts.isCancel(result)) throw new UI.CancelledError()
        selected = result
      }

      // Get mode
      let mode: AgentMode
      if (cliMode) {
        mode = cliMode
      } else {
        const modeResult = await prompts.select({
          message: "Agent mode",
          options: [
            {
              label: "All",
              value: "all" as const,
              hint: "Can function in both primary and subagent roles",
            },
            {
              label: "Primary",
              value: "primary" as const,
              hint: "Acts as a primary/main agent",
            },
            {
              label: "Subagent",
              value: "subagent" as const,
              hint: "Can be used as a subagent by other agents",
            },
          ],
          initialValue: "all" as const,
        })
        if (prompts.isCancel(modeResult)) throw new UI.CancelledError()
        mode = modeResult
      }

      // Build permissions config — deny anything not explicitly selected.
      const permissions: Record<string, "deny"> = {}
      for (const permission of AVAILABLE_PERMISSIONS) {
        if (!selected.includes(permission)) {
          permissions[permission] = "deny"
        }
      }

      // Build frontmatter
      const frontmatter: {
        description: string
        mode: AgentMode
        permission?: Record<string, "deny">
      } = {
        description: generated.whenToUse,
        mode,
      }
      if (Object.keys(permissions).length > 0) {
        frontmatter.permission = permissions
      }

      // Write file
      const content = matter.stringify(generated.systemPrompt, frontmatter)
      const filePath = path.join(targetPath, `${generated.identifier}.md`)

      await fs.mkdir(targetPath, { recursive: true })

      if (await Filesystem.exists(filePath)) {
        if (isFullyNonInteractive) {
          console.error(`Error: Agent file already exists: ${filePath}`)
          process.exit(1)
        }
        prompts.log.error(`Agent file already exists: ${filePath}`)
        throw new UI.CancelledError()
      }

      await Filesystem.write(filePath, content)

      if (isFullyNonInteractive) {
        console.log(filePath)
      } else {
        prompts.log.success(`Agent created: ${filePath}`)
        prompts.outro("Done")
      }
    })
  }),
})

const AgentListCommand = effectCmd({
  command: "list",
  describe: "list all available agents",
  handler: Effect.fn("Cli.agent.list")(function* () {
    const { Agent } = yield* Effect.promise(() => import("../../agent/agent"))
    const agents = yield* Agent.Service.use((svc) => svc.list())
    const sortedAgents = agents.sort((a, b) => {
      if (a.native !== b.native) {
        return a.native ? -1 : 1
      }
      return a.name.localeCompare(b.name)
    })

    for (const agent of sortedAgents) {
      process.stdout.write(`${agent.name} (${agent.mode})` + EOL)
      process.stdout.write(`  ${JSON.stringify(agent.permission, null, 2)}` + EOL)
    }
  }),
})

function platformError(error: unknown) {
  process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}${EOL}`)
  process.exitCode = 1
}

const AgentMemoryCommand = cmd({
  command: "memory <operation> [query..]",
  describe: "manage local, redacted, cross-session agent memory",
  builder: (yargs: Argv) =>
    yargs
      .positional("operation", { choices: ["add", "list", "search"] as const, describe: "memory operation" })
      .positional("query", { type: "string", array: true, describe: "search text" })
      .option("content", { type: "string", describe: "memory text for add" })
      .option("scope", { choices: ["device", "project", "channel"] as const, default: "device", describe: "memory visibility scope" })
      .option("scope-id", { type: "string", default: "default", describe: "scope identifier" })
      .option("kind", { choices: ["fact", "preference", "decision", "summary", "instruction"] as const, default: "fact", describe: "memory classification" })
      .option("confidence", { type: "number", default: 0.8, describe: "confidence from 0 to 1" }),
  async handler(args: any) {
    const store = new AgentPlatformStore()
    try {
      const scope = args.scope as MemoryScope
      const scopeId = args.scopeId as string
      if (args.operation === "add") {
        if (!args.content) throw new Error("Memory content required. Use: nexus agent memory add --content \"...\"")
        const memory = store.addMemory({ scope, scopeId, kind: args.kind as MemoryKind, content: args.content, confidence: args.confidence })
        process.stdout.write(`Saved redacted ${memory.kind} memory ${memory.id} in ${memory.scope}:${memory.scopeId}${EOL}`)
        return
      }
      const memories = args.operation === "search"
        ? store.searchMemory((args.query ?? []).join(" "), scope, scopeId)
        : store.listMemory(scope, scopeId)
      if (!memories.length) {
        process.stdout.write(`No active memory in ${scope}:${scopeId}${EOL}`)
        return
      }
      for (const memory of memories) process.stdout.write(`${memory.id}\t${memory.kind}\t${memory.confidence}\t${memory.content}${EOL}`)
    } catch (error) {
      platformError(error)
    } finally {
      store.close()
    }
  },
})

const AgentLearningCommand = cmd({
  command: "learning <operation> [id]",
  describe: "review and approve reusable learning proposals; no proposal activates automatically",
  builder: (yargs: Argv) =>
    yargs
      .positional("operation", { choices: ["propose", "list", "approve", "reject"] as const, describe: "learning operation" })
      .positional("id", { type: "string", describe: "proposal id for approve or reject" })
      .option("run", { type: "string", describe: "source run id for a proposal" })
      .option("title", { type: "string", describe: "proposal title" })
      .option("summary", { type: "string", describe: "proposal summary" })
      .option("skill", { type: "string", describe: "draft reusable skill text" })
      .option("status", { choices: ["proposed", "approved", "rejected", "superseded"] as const, describe: "optional list filter" }),
  async handler(args: any) {
    const store = new AgentPlatformStore()
    try {
      if (args.operation === "propose") {
        if (!args.run || !args.title || !args.skill) throw new Error("Proposal requires --run, --title, and --skill")
        const proposal = store.proposeLearning({ runId: args.run, title: args.title, summary: args.summary ?? "", skillDraft: args.skill })
        process.stdout.write(`Learning proposal ${proposal.id} saved as proposed. Review with: nexus agent learning approve ${proposal.id}${EOL}`)
        return
      }
      if (args.operation === "approve") {
        if (!args.id) throw new Error("Proposal id required")
        store.approveLearning(args.id)
        process.stdout.write(`Learning proposal ${args.id} approved and revisioned${EOL}`)
        return
      }
      if (args.operation === "reject") {
        if (!args.id) throw new Error("Proposal id required")
        store.rejectLearning(args.id)
        process.stdout.write(`Learning proposal ${args.id} rejected${EOL}`)
        return
      }
      const proposals = store.listLearning(args.status as LearningStatus | undefined)
      if (!proposals.length) process.stdout.write("No learning proposals found" + EOL)
      for (const proposal of proposals) process.stdout.write(`${proposal.id}\t${proposal.status}\t${proposal.title}\t${proposal.summary}${EOL}`)
    } catch (error) {
      platformError(error)
    } finally {
      store.close()
    }
  },
})

const AgentScheduleCommand = cmd({
  command: "schedule <operation>",
  describe: "define local schedules; new schedules remain disabled until a later explicit enable flow",
  builder: (yargs: Argv) =>
    yargs
      .positional("operation", { choices: ["add", "list"] as const, describe: "schedule operation" })
      .option("name", { type: "string", describe: "unique schedule name" })
      .option("cron", { type: "string", describe: "cron expression" })
      .option("timezone", { type: "string", default: "UTC", describe: "IANA time zone" })
      .option("task", { type: "string", describe: "redacted task payload" }),
  async handler(args: any) {
    const store = new AgentPlatformStore()
    try {
      if (args.operation === "add") {
        if (!args.name || !args.cron || !args.task) throw new Error("Schedule requires --name, --cron, and --task")
        const schedule = store.createSchedule({ name: args.name, expression: args.cron, timezone: args.timezone, payload: args.task })
        process.stdout.write(`Schedule ${schedule.name} created disabled. It will not run until an explicit scheduler enable flow is added.${EOL}`)
        return
      }
      const schedules = store.listSchedules()
      if (!schedules.length) process.stdout.write("No agent schedules defined" + EOL)
      for (const schedule of schedules) process.stdout.write(`${schedule.id}\t${schedule.enabled ? "enabled" : "disabled"}\t${schedule.expression}\t${schedule.timezone}\t${schedule.name}${EOL}`)
    } catch (error) {
      platformError(error)
    } finally {
      store.close()
    }
  },
})

const AgentRunCommand = cmd({
  command: "run <operation>",
  describe: "plan bounded local subagent work; planning does not start hidden background execution",
  builder: (yargs: Argv) =>
    yargs
      .positional("operation", { choices: ["plan", "list"] as const, describe: "run operation" })
      .option("children", { type: "number", default: 2, describe: "maximum child agents, from 0 to 12" })
      .option("parallel", { type: "number", default: 3, describe: "maximum total parallel agents, from 1 to 12" })
      .option("budget", { choices: ["low", "standard", "high"] as const, default: "standard", describe: "execution budget class" })
      .option("idempotency-key", { type: "string", describe: "optional replay-safe planning key" }),
  async handler(args: any) {
    const store = new AgentPlatformStore()
    try {
      if (args.operation === "plan") {
        const run = store.createRun({
          idempotencyKey: args.idempotencyKey,
          policy: { maxChildren: args.children, maxParallel: args.parallel, budgetClass: args.budget },
        })
        process.stdout.write(`Planned local run ${run.id}: lead + up to ${run.policy.maxChildren} children, max ${run.policy.maxParallel} parallel. No background work started.${EOL}`)
        return
      }
      const runs = store.listRuns()
      if (!runs.length) process.stdout.write("No durable agent runs planned" + EOL)
      for (const run of runs) process.stdout.write(`${run.id}\t${run.status}\t${run.policy.budgetClass}\tchildren=${run.policy.maxChildren}\tparallel=${run.policy.maxParallel}${EOL}`)
    } catch (error) {
      platformError(error)
    } finally {
      store.close()
    }
  },
})

export const AgentCommand = cmd({
  command: "agent",
  describe: "manage agents",
  builder: (yargs) => yargs.command(AgentCreateCommand).command(AgentListCommand).command(AgentMemoryCommand).command(AgentLearningCommand).command(AgentScheduleCommand).command(AgentRunCommand).demandCommand(),
  async handler() {},
})
