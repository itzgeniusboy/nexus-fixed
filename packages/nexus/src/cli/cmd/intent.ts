import { EOL } from "node:os"
import { cmd } from "./cmd"
import { apiVaultKeyPath, apiVaultPublicRows, apiVaultRows, getApiUsageBudget, getApiVaultStatus } from "../../api/ApiVault"
import { formatApiReadiness, formatApiRoutePreview, formatApiUsageBudget, formatApiVaultList } from "./api"
import { formatSpecialistRole, formatSpecialistRoles, specialistRoleNames, type SpecialistRoleName } from "./agent-roles"
import { collectDeviceReadiness, formatDeviceReadiness } from "./device"
import { formatInstructionExplanation, formatInstructionStatus } from "./instructions"
import { clearWorkspaceSelection, formatWorkspaceSelection, readWorkspaceSelection } from "./workspace"
import {
  collectTranslationFiles,
  createTranslationPlan,
  formatTranslationPlan,
  translationLanguages,
  type TranslationLanguage,
} from "./translator"
import { getDeviceConfig } from "@nexus-ai/core/device"
import { formatLocalModelCatalog, formatLocalModelRecommendations } from "./local-models"
import { routeModel } from "../../api/ModelRouter"

const MAX_INTENT_INPUT_LENGTH = 1_000

export type IntentInspection = {
  category:
    | "code"
    | "diagnostics"
    | "workspace"
    | "workspace-mutation"
    | "translation"
    | "version-control"
    | "api-status"
    | "agent-role"
    | "permission"
    | "device"
    | "instructions"
    | "local-model"
    | "model-route"
    | "termux"
    | "voice"
    | "webtest"
    | "unknown"
    | "sensitive-input"
    | "input-too-long"
  plugin?: string
  command?: string
  confidence: "high" | "none"
  execution: "not-run"
}

type IntentRule = Pick<IntentInspection, "category" | "plugin" | "command"> & { pattern: RegExp }

const intentRules: readonly IntentRule[] = [
  {
    pattern: /(?:code|project|app|website|portfolio|todo).*(?:banao|bana|generate|create|scaffold)/i,
    category: "code",
    plugin: "codegen",
    command: "generate",
  },
  {
    pattern: /(?:env|environment|variable|\.env).*(?:check|scan|detect|missing|fix)?/i,
    category: "diagnostics",
    plugin: "devtools",
    command: "env:scan",
  },
  {
    pattern: /(?:error|bug).*(?:fix|doctor|explain)|(?:log)\s*doctor/i,
    category: "diagnostics",
    plugin: "devtools",
    command: "doctor:explain",
  },
  {
    pattern:
      /(?:clear|remove|delete|hatado|hata do).*(?:workspace|project).*(?:bookmark|selection)|(?:workspace|project).*(?:bookmark|selection).*(?:clear|remove|delete|hatado|hata do)/i,
    category: "workspace-mutation",
    plugin: "workspace",
    command: "clear selection bookmark",
  },
  {
    pattern:
      /(?:(?:workspace|project).*(?:selected|current|active)|(?:selected|current|active).*(?:workspace|project)).*(?:status|which|kaun|konsa|kon sa|show|dikhao)?/i,
    category: "workspace",
    plugin: "workspace",
    command: "selected",
  },
  {
    pattern: /(?:workspace|project).*(?:show|details?|detail|info|information)/i,
    category: "workspace",
    plugin: "workspace",
    command: "show",
  },
  {
    pattern: /(?:workspace|project).*(?:list|naam|name)/i,
    category: "workspace",
    plugin: "workspace",
    command: "list",
  },
  {
    pattern:
      /(?:(?:translate|translation|convert|badlo).*(?:php|python|go|typescript|javascript))|(?:(?:php|python|go|typescript|javascript).*(?:translate|translation|convert|badlo))/i,
    category: "translation",
    plugin: "translator",
    command: "plan",
  },
  { pattern: /(?:commit|git\s*review|pr\s*banao)/i, category: "version-control", plugin: "gitpro", command: "commit" },
  {
    pattern: /(?:api|keys?|key).*(?:readiness|ready)|(?:readiness|ready).*(?:api|keys?|key)/i,
    category: "api-status",
    plugin: "api",
    command: "readiness",
  },
  {
    pattern:
      /(?:local|offline|device).*(?:model).*(?:catalog|recommendations?|recommend|suggest|ram|storage|gpu|download)|(?:catalog|recommendations?|recommend|suggest).*(?:local|offline|device).*(?:model)/i,
    category: "local-model",
    plugin: "models",
    command: "local recommendations",
  },
  {
    pattern:
      /(?:deepseek|llama\s*3(?:\.1)?|gemini|gpt\s*-?4).*(?:model\s*)?(?:route|fallback|provider)|(?:route|fallback|provider).*(?:deepseek|llama\s*3(?:\.1)?|gemini|gpt\s*-?4)/i,
    category: "model-route",
    plugin: "api",
    command: "route preview",
  },
  {
    pattern:
      /(?:api|requests?|tokens?).*(?:budget|caps?|limits?)|(?:budget|caps?|limits?).*(?:api|requests?|tokens?)/i,
    category: "api-status",
    plugin: "api",
    command: "budget",
  },
  {
    pattern:
      /(?:api|keys?|key).*(?:list|status|usage|tokens?|total|kitne|kitna|remaining|bache|bach|health)|(?:list|status|usage|tokens?|total|kitne|kitna|remaining|bache|bach|health).*(?:api|keys?|key)/i,
    category: "api-status",
    plugin: "api",
    command: "list",
  },
  {
    pattern: /(?:agent\s*)?roles?.*(?:list|all|available|saare|sab)|(?:list|all|available|saare|sab).*(?:agent\s*)?roles?/i,
    category: "agent-role",
    plugin: "agent",
    command: "role list",
  },
  {
    pattern:
      /(?:agent\s*)?(?:role|planner|coder|reviewer|tester).*(?:show|policy|rules?|constraints?|settings?|details?|info|information|dekhao|dikhao)|(?:show|policy|rules?|constraints?|settings?|details?|info|information|dekhao|dikhao).*(?:agent\s*)?(?:role|planner|coder|reviewer|tester)/i,
    category: "agent-role",
    plugin: "agent",
    command: "role show",
  },
  {
    pattern:
      /(?:permission|allow|deny|denied|access).*(?:explain|check|inspect|status|kyu|kyon|why)|(?:bash|edit|read|webfetch|question).*(?:permission|allow|deny|denied)/i,
    category: "permission",
    plugin: "permission",
    command: "explain",
  },
  {
    pattern:
      /(?:instructions?|nexus\.md|agents\.md|claude\.md|context\.md).*(?:explain|precedence|order|priority|rules?)|(?:explain|precedence|order|priority).*(?:instructions?|nexus\.md|agents\.md|claude\.md|context\.md)/i,
    category: "instructions",
    plugin: "instructions",
    command: "explain",
  },
  {
    pattern:
      /(?:instructions?|nexus\.md|agents\.md|claude\.md|context\.md).*(?:status|list|show|dikhao|dekhao|check)|(?:status|list|show|dikhao|dekhao|check).*(?:instructions?|nexus\.md|agents\.md|claude\.md|context\.md)/i,
    category: "instructions",
    plugin: "instructions",
    command: "status",
  },
  {
    pattern:
      /(?:device|termux|android|pc|phone).*(?:readiness|ready|ram|memory|storage|battery|thermal)|(?:readiness|ram|memory|storage|battery|thermal).*(?:device|termux|android|pc|phone)/i,
    category: "device",
    plugin: "device",
    command: "readiness",
  },
  {
    pattern: /(?:notification|notify|toast|battery|clipboard|apk|location)/i,
    category: "termux",
    plugin: "termux",
    command: "run",
  },
  { pattern: /(?:voice|bol|sun|speak|listen|awaaz)/i, category: "voice", plugin: "voice", command: "listen" },
  {
    pattern: /(?:website|site|page|url).*(?:test|check|bugs?)|(?:design|ui|ux|layout).*(?:check|review|analyze|qa)/i,
    category: "webtest",
    plugin: "webtest",
    command: "run",
  },
]

function containsSensitiveValue(value: string): boolean {
  return /(?:\bbearer\s+[a-z0-9._~+\/-]{12,}|\b(?:api[_ -]?key|password|otp|session[_ -]?token)\s*[:=]\s*\S+|\b(?:sk|pk)_[a-z0-9_-]{16,}|\bghp_[a-z0-9]{20,})/i.test(
    value,
  )
}

export function inspectIntent(value: string): IntentInspection {
  if (value.length > MAX_INTENT_INPUT_LENGTH)
    return { category: "input-too-long", confidence: "none", execution: "not-run" }
  if (containsSensitiveValue(value)) return { category: "sensitive-input", confidence: "none", execution: "not-run" }
  for (const rule of intentRules) {
    if (rule.pattern.test(value)) {
      return {
        category: rule.category,
        plugin: rule.plugin,
        command: rule.command,
        confidence: "high",
        execution: "not-run",
      }
    }
  }
  return { category: "unknown", confidence: "none", execution: "not-run" }
}

export function formatIntentInspection(result: IntentInspection, format: "table" | "json"): string {
  if (format === "json") return JSON.stringify(result, null, 2)
  const lines = [
    `Category: ${result.category}`,
    `Suggested local route: ${result.plugin && result.command ? `${result.plugin}:${result.command}` : "none"}`,
    `Confidence: ${result.confidence}`,
    "Execution: not run",
  ]
  if (result.category === "sensitive-input")
    lines.push(
      "Sensitive-looking input was not classified or echoed. Remove it and retry with a non-secret task description.",
    )
  else if (result.category === "input-too-long")
    lines.push("Input exceeded the local inspection bound and was not classified.")
  else
    lines.push(
      "Inspection only: no model call, plugin load, command execution, install, write, or persistent route preference occurred.",
    )
  return lines.join(EOL)
}

export type IntentExecution = Omit<IntentInspection, "execution"> & {
  execution: "executed" | "blocked"
  result?: string
  reason?: string
}

export type IntentExecutionOptions = {
  confirmLocal?: boolean
  workspaceSelectionDirectory?: string
}

function roleNamedIn(value: string): SpecialistRoleName | undefined {
  return specialistRoleNames.find((role) => new RegExp(`\\b${role}\\b`, "i").test(value))
}

function blockedExecution(inspection: IntentInspection, reason: string): IntentExecution {
  return { ...inspection, execution: "blocked", reason }
}

function requestedTranslationLanguages(value: string): { source: TranslationLanguage; target: TranslationLanguage } | undefined {
  const names = new RegExp(`\\b(${translationLanguages.join("|")})\\b`, "gi")
  const found: TranslationLanguage[] = []
  for (const match of value.matchAll(names)) {
    const language = match[1].toLowerCase() as TranslationLanguage
    if (!found.includes(language)) found.push(language)
  }
  if (found.length !== 2 || found[0] === found[1]) return undefined
  return { source: found[0], target: found[1] }
}

function requestedKnownModelAlias(value: string): "deepseek" | "llama3_1" | "gemini" | "gpt4" | undefined {
  if (/\bdeepseek\b/i.test(value)) return "deepseek"
  if (/\bllama\s*3(?:\.1)?\b/i.test(value)) return "llama3_1"
  if (/\bgemini\b/i.test(value)) return "gemini"
  if (/\bgpt\s*-?4\b/i.test(value)) return "gpt4"
  return undefined
}

/**
 * Executes only a literal allowlist of local formatters. The sole mutation requires
 * a separate explicit confirmation. It never shells out, loads plugins, calls a
 * model/provider, validates keys, changes vault/route state, or forwards the user
 * message to another subsystem.
 */
export async function executeLocalIntent(value: string, options: IntentExecutionOptions = {}): Promise<IntentExecution> {
  const inspection = inspectIntent(value)
  if (inspection.confidence !== "high") {
    return blockedExecution(inspection, "Only a bounded, high-confidence read-only local intent may be executed.")
  }
  if (inspection.category === "api-status") {
    if (inspection.command === "list") {
      const status = getApiVaultStatus()
      return {
        ...inspection,
        execution: "executed",
        result: formatApiVaultList({
          vaultPath: apiVaultKeyPath(),
          autoRotate: status.autoRotate,
          budget: getApiUsageBudget(),
          rows: apiVaultRows(),
        }),
      }
    }
    if (inspection.command === "budget") {
      return { ...inspection, execution: "executed", result: formatApiUsageBudget(getApiUsageBudget()) }
    }
    if (inspection.command === "readiness") {
      const status = getApiVaultStatus()
      return {
        ...inspection,
        execution: "executed",
        result: formatApiReadiness({ autoRotate: status.autoRotate, budget: getApiUsageBudget(), rows: apiVaultRows() }),
      }
    }
  }
  if (inspection.category === "agent-role") {
    if (inspection.command === "role list") return { ...inspection, execution: "executed", result: formatSpecialistRoles("table") }
    if (inspection.command === "role show") {
      const role = roleNamedIn(value)
      return role
        ? { ...inspection, execution: "executed", result: formatSpecialistRole(role, "table") }
        : blockedExecution(inspection, "Name one supported role: planner, coder, reviewer, or tester.")
    }
  }
  if (inspection.category === "translation" && inspection.command === "plan") {
    const languages = requestedTranslationLanguages(value)
    if (!languages) {
      return blockedExecution(
        inspection,
        "State exactly two distinct supported languages: typescript, javascript, python, php, or go.",
      )
    }
    try {
      const root = process.cwd()
      const collected = await collectTranslationFiles({ root, scope: ".", language: languages.source, maxFiles: 50 })
      return {
        ...inspection,
        execution: "executed",
        result: formatTranslationPlan(
          createTranslationPlan({
            source: languages.source,
            target: languages.target,
            scope: ".",
            files: collected.files,
            truncated: collected.truncated,
          }),
          "table",
        ),
      }
    } catch {
      return blockedExecution(inspection, "The current project could not be inventoried within the bounded local plan.")
    }
  }
  if (inspection.category === "local-model" && inspection.command === "local recommendations") {
    const config = getDeviceConfig()
    return {
      ...inspection,
      execution: "executed",
      result: /\bcatalog\b/i.test(value)
        ? formatLocalModelCatalog(config)
        : formatLocalModelRecommendations(config).join(EOL),
    }
  }
  if (inspection.category === "model-route" && inspection.command === "route preview") {
    const alias = requestedKnownModelAlias(value)
    if (!alias) return blockedExecution(inspection, "Name one supported route alias: deepseek, llama 3.1, gemini, or gpt-4.")
    return {
      ...inspection,
      execution: "executed",
      result: formatApiRoutePreview({ model: alias, routes: routeModel(alias), rows: apiVaultPublicRows() }),
    }
  }
  if (inspection.category === "device" && inspection.command === "readiness") {
    const readiness = await collectDeviceReadiness()
    return { ...inspection, execution: "executed", result: formatDeviceReadiness(readiness, "table") }
  }
  if (inspection.category === "instructions") {
    if (inspection.command === "explain") return { ...inspection, execution: "executed", result: formatInstructionExplanation() }
    if (inspection.command === "status") {
      const directory = process.cwd()
      return { ...inspection, execution: "executed", result: formatInstructionStatus(directory, directory) }
    }
  }
  if (inspection.category === "workspace" && inspection.command === "selected") {
    return { ...inspection, execution: "executed", result: formatWorkspaceSelection(await readWorkspaceSelection()) }
  }
  if (inspection.category === "workspace-mutation" && inspection.command === "clear selection bookmark") {
    if (!options.confirmLocal) {
      return blockedExecution(
        inspection,
        "Clearing the local workspace selection bookmark requires --confirm-local. No mutation was performed.",
      )
    }
    const cleared = await clearWorkspaceSelection(options.workspaceSelectionDirectory)
    return {
      ...inspection,
      execution: "executed",
      result: cleared
        ? "Cleared the local workspace selection bookmark. This did not change the shell directory, project/source/configuration/session state, provider/vault/model state, or any remote resource."
        : "No local workspace selection bookmark existed. Nothing was changed.",
    }
  }
  return blockedExecution(
    inspection,
    "This suggested route is not in the explicit read-only execution allowlist and was not run.",
  )
}

export function formatIntentExecution(result: IntentExecution, format: "table" | "json"): string {
  if (format === "json") return JSON.stringify(result, null, 2)
  const lines = [
    `Category: ${result.category}`,
    `Suggested local route: ${result.plugin && result.command ? `${result.plugin}:${result.command}` : "none"}`,
    `Confidence: ${result.confidence}`,
    `Execution: ${result.execution === "executed" ? (result.category === "workspace-mutation" ? "completed locally (confirmed mutation)" : "completed locally (read-only)") : "blocked"}`,
  ]
  if (result.execution === "executed" && result.result) lines.push("Result:", result.result)
  else if (result.reason) lines.push(`Reason: ${result.reason}`)
  lines.push(
    result.category === "workspace-mutation" && result.execution === "executed"
      ? "Execution boundary: only the explicitly confirmed local workspace selection bookmark was cleared; no model call, plugin load, shell execution, remote request, key check, route selection, or other persistent preference change occurred."
      : "Execution boundary: no model call, plugin load, shell execution, remote request, key check, write, route selection, or persistent preference occurred.",
  )
  return lines.join(EOL)
}

export const IntentCommand = cmd({
  command: "intent <message..>",
  describe: "inspect a bounded Hinglish/English intent locally; `--execute-local` has a strict read-only allowlist",
  builder: (yargs) =>
    yargs
      .positional("message", {
        type: "string",
        array: true,
        demandOption: true,
        describe: "non-sensitive request to inspect",
      })
      .option("format", { choices: ["table", "json"] as const, default: "table", describe: "output format" })
      .option("execute-local", {
        type: "boolean",
        default: false,
        describe: "explicitly run a hard-coded local read-only allowlist; all other suggestions remain blocked",
      })
      .option("confirm-local", {
        type: "boolean",
        default: false,
        describe: "separately confirm the one supported local mutation; has no effect without --execute-local",
      }),
  async handler(args: { message: string[]; format?: "table" | "json"; executeLocal?: boolean; confirmLocal?: boolean }) {
    const message = args.message.join(" ")
    if (args.executeLocal) {
      process.stdout.write(
        formatIntentExecution(await executeLocalIntent(message, { confirmLocal: args.confirmLocal }), args.format ?? "table") + EOL,
      )
      return
    }
    process.stdout.write(formatIntentInspection(inspectIntent(message), args.format ?? "table") + EOL)
  },
})
