import type { Argv } from "yargs"
import { cmd } from "./cmd"
import * as prompts from "@clack/prompts"
import {
  API_PROVIDERS,
  resolveProviderLabel,
  addApiKey as vaultAddApiKey,
  apiVaultKeyPath,
  apiVaultRows,
  getApiVaultStatus,
  maskApiKey,
  normalizeProvider,
  removeApiKey as vaultRemoveApiKey,
  setAutoRotation,
  updateApiKeyStatus,
  type ApiKeyStatus,
} from "../../api/ApiVault"
import { routeModel, routeSummary } from "../../api/ModelRouter"

function printError(error: unknown): void {
  process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`)
}

import { checkKey } from "../../api/ApiVault"

async function runWizard(): Promise<void> {
  prompts.intro("Add your API key")
  prompts.log.info("Har provider ke liye key paste karo — skip karne ke liye bas ENTER.")

  let saved = 0
  for (const provider of API_PROVIDERS) {
    const label = resolveProviderLabel(provider)
    const result = await prompts.password({
      message: `${label} API key (ENTER = skip)`,
    })
    if (prompts.isCancel(result) || !result || !result.trim()) continue
    try {
      vaultAddApiKey(provider, result.trim())
      saved++
      prompts.log.success(`${label} saved (${maskApiKey(result.trim())})`)
    } catch (error) {
      prompts.log.warn(`${provider}: ${error instanceof Error ? error.message : "failed"}`)
    }
  }
  prompts.outro(saved > 0 ? `${saved} API key(s) vault mein stored` : "No keys added")
}

const AddCommand = cmd({
  command: "add [provider] [key] [label]",
  describe: "store an API key in the local NEXUS vault (no args = multi-provider wizard)",
  builder: (yargs: Argv) =>
    yargs
      .positional("provider", {
        describe:
          "provider id/alias (openai, anthropic, claude, gemini, groq, openrouter, xai/grok, deepseek, mistral, together, perplexity, cohere, fireworks, kimi, cerebras) — omit for wizard",
        type: "string",
      })
      .positional("key", { type: "string", describe: "API key" })
      .positional("label", { type: "string", describe: "optional label" }),
  async handler(args: { provider?: string; key?: string; label?: string }) {
    if (!args.provider) {
      await runWizard()
      return
    }
    if (!args.key) {
      printError(new Error(`Key required. Usage: nexus api add ${args.provider} <key> — or bare 'nexus api add' for the wizard.`))
      process.exitCode = 1
      return
    }
    try {
      const entry = vaultAddApiKey(args.provider, args.key, args.label)
      const label = resolveProviderLabel(normalizeProvider(args.provider) ?? args.provider.toLowerCase())
      process.stdout.write(`✓ ${label} key saved (${entry.label})\n`)
      process.stdout.write(`  Vault: ${apiVaultKeyPath()}\n`)
      process.stdout.write(`  Stored: ${maskApiKey(entry.key)}\n`)
    } catch (error) {
      printError(error)
      process.exitCode = 1
    }
  },
})

const ListCommand = cmd({
  command: "list",
  describe: "list stored API keys with masked values and status",
  builder: (yargs: Argv) => yargs,
  async handler() {
    const rows = apiVaultRows()
    const config = getApiVaultStatus()
    process.stdout.write(`Vault: ${apiVaultKeyPath()}\n`)
    process.stdout.write(`Auto-rotation: ${config.autoRotate ? "on" : "off"}\n`)
    if (rows.length === 0) {
      process.stdout.write("No API keys stored. Add one with: nexus api add <provider> <key> [label]\n")
      return
    }
    process.stdout.write("Provider\t#\tLabel\tKey\tStatus\tToday\n")
    for (const row of rows) {
      process.stdout.write(`${row.provider}\t${row.index}\t${row.label}\t${row.key}\t${row.status}\t${row.usage.todayRequests} req / ${row.usage.todayInputTokens + row.usage.todayOutputTokens} tok\n`)
    }
  },
})

const CheckCommand = cmd({
  command: "check",
  describe: "test all stored API keys without printing secrets",
  builder: (yargs: Argv) => yargs,
  async handler() {
    const rows = apiVaultRows()
    if (rows.length === 0) {
      process.stdout.write("No API keys stored. Add one with: nexus api add <provider> <key> [label]\n")
      return
    }
    process.stdout.write("Checking API keys (secrets remain masked)...\n")
    for (const row of rows) {
      const vault = (await import("../../api/ApiVault")).loadApiVault()
      const rawKey = vault.providers[row.provider]?.[row.index - 1]?.key ?? ""
      const result = await checkKey(row.provider, rawKey)
      const suffix = result.code ? ` HTTP ${result.code}` : ""
      process.stdout.write(`${result.status === "active" ? "✓" : result.status === "rate_limited" ? "!" : "✗"} ${row.provider} #${row.index} ${row.label} ${row.key} — ${result.status}${suffix}\n`)
      if (rawKey) updateApiKeyStatus(row.provider, rawKey, result.status, result)
    }
  },
})

const RemoveCommand = cmd({
  command: "remove <provider> <index>",
  describe: "remove a key by provider and one-based index",
  builder: (yargs: Argv) => yargs.positional("index", { type: "number", describe: "one-based key index" }),
  async handler(args: { provider: string; index: number }) {
    try {
      const removed = vaultRemoveApiKey(args.provider, args.index)
      process.stdout.write(`✓ Removed ${args.provider.toLowerCase()} key #${args.index} (${removed.label}, ${maskApiKey(removed.key)})\n`)
    } catch (error) {
      printError(error)
      process.exitCode = 1
    }
  },
})

const RotateCommand = cmd({
  command: "rotate <state>",
  describe: "turn automatic provider/key rotation on or off",
  builder: (yargs: Argv) => yargs.positional("state", { type: "string", choices: ["on", "off"] as const }),
  async handler(args: { state: "on" | "off" }) {
    setAutoRotation(args.state === "on")
    process.stdout.write(`✓ API rotation ${args.state}\n`)
  },
})

const RouteCommand = cmd({
  command: "route <model>",
  describe: "show configured providers for a model alias",
  builder: (yargs: Argv) => yargs,
  async handler(args: { model: string }) {
    const routes = routeModel(args.model)
    process.stdout.write(`Model: ${args.model}\n`)
    process.stdout.write(`Route: ${routeSummary(args.model)}\n`)
    for (const route of routes) process.stdout.write(`${route.provider}/${route.model}\t${route.reason}\n`)
  },
})

const WizardDefault = cmd({
  command: "$0",
  describe: "open the multi-provider API key wizard",
  builder: (yargs: Argv) => yargs,
  async handler() {
    await runWizard()
  },
})

export const ApiCommand = cmd({
  command: "api",
  describe: "manage API keys and smart model routing",
  builder: (yargs: Argv) => yargs.command(WizardDefault).command(AddCommand).command(ListCommand).command(CheckCommand).command(RemoveCommand).command(RotateCommand).command(RouteCommand),
  async handler() {},
})
