import { EOL } from "node:os"
import { cmd } from "./cmd"

const MAX_INTENT_INPUT_LENGTH = 1_000

export type IntentInspection = {
  category:
    | "code"
    | "diagnostics"
    | "workspace"
    | "translation"
    | "version-control"
    | "agent-role"
    | "permission"
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
    pattern: /(?:translate|convert|badlo|convert karo).*(?:php|python|nodejs?|typescript|javascript|tailwind|vue)/i,
    category: "translation",
    plugin: "translator",
    command: "plan",
  },
  { pattern: /(?:commit|git\s*review|pr\s*banao)/i, category: "version-control", plugin: "gitpro", command: "commit" },
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

export const IntentCommand = cmd({
  command: "intent <message..>",
  describe: "inspect a bounded Hinglish/English intent locally without running it",
  builder: (yargs) =>
    yargs
      .positional("message", {
        type: "string",
        array: true,
        demandOption: true,
        describe: "non-sensitive request to inspect",
      })
      .option("format", { choices: ["table", "json"] as const, default: "table", describe: "output format" }),
  handler(args: { message: string[]; format?: "table" | "json" }) {
    const result = inspectIntent(args.message.join(" "))
    process.stdout.write(formatIntentInspection(result, args.format ?? "table") + EOL)
  },
})
