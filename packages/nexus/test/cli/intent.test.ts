import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { executeLocalIntent, formatIntentExecution, formatIntentInspection, inspectIntent } from "../../src/cli/cmd/intent"
import { readWorkspaceSelection, writeWorkspaceSelection } from "../../src/cli/cmd/workspace"

describe("local intent inspection", () => {
  test("classifies bounded Hinglish and English requests deterministically without execution", () => {
    expect(inspectIntent("workspace ke project list dikhao")).toEqual({
      category: "workspace",
      plugin: "workspace",
      command: "list",
      confidence: "high",
      execution: "not-run",
    })
    expect(inspectIntent("current selected workspace dikhao")).toMatchObject({
      category: "workspace",
      plugin: "workspace",
      command: "selected",
      execution: "not-run",
    })
    expect(inspectIntent("project ki details dikhao")).toMatchObject({
      category: "workspace",
      plugin: "workspace",
      command: "show",
      execution: "not-run",
    })
    expect(inspectIntent("please check env variables")).toMatchObject({
      category: "diagnostics",
      plugin: "devtools",
      command: "env:scan",
      execution: "not-run",
    })
    expect(inspectIntent("awaaz se command suno")).toMatchObject({
      category: "voice",
      plugin: "voice",
      execution: "not-run",
    })
    expect(inspectIntent("bash permission denied kyu hai")).toEqual({
      category: "permission",
      plugin: "permission",
      command: "explain",
      confidence: "high",
      execution: "not-run",
    })
    expect(inspectIntent("reviewer agent role policy dikhao")).toMatchObject({
      category: "agent-role",
      plugin: "agent",
      command: "role show",
      execution: "not-run",
    })
    expect(inspectIntent("agent ke saare roles list dikhao")).toMatchObject({
      category: "agent-role",
      plugin: "agent",
      command: "role list",
      execution: "not-run",
    })
    expect(inspectIntent("meri total API keys aur tokens usage dikhao")).toMatchObject({
      category: "api-status",
      plugin: "api",
      command: "list",
      execution: "not-run",
    })
    expect(inspectIntent("API token budget aur daily limit batao")).toMatchObject({
      category: "api-status",
      plugin: "api",
      command: "budget",
      execution: "not-run",
    })
  })

  test("blocks sensitive or oversized input without echoing it or proposing a route", () => {
    const sensitive = inspectIntent("workspace ka password: correct-horse-battery-staple")
    const output = formatIntentInspection(sensitive, "table")
    const oversized = inspectIntent("a".repeat(1_001))

    expect(sensitive).toEqual({ category: "sensitive-input", confidence: "none", execution: "not-run" })
    expect(output).toContain("Sensitive-looking input was not classified or echoed")
    expect(output).not.toContain("correct-horse")
    expect(oversized).toEqual({ category: "input-too-long", confidence: "none", execution: "not-run" })
  })

  test("keeps unknown input local and side-effect-free", () => {
    const result = inspectIntent("kuch bilkul alag karna hai")
    expect(result).toEqual({ category: "unknown", confidence: "none", execution: "not-run" })
    expect(formatIntentInspection(result, "json")).not.toContain("query")
  })

  test("does not suggest a mutation route for workspace selection requests", () => {
    expect(inspectIntent("mera project select kar do")).toEqual({
      category: "unknown",
      confidence: "none",
      execution: "not-run",
    })
  })

  test("requires a separate confirmation before clearing only the local workspace selection bookmark", async () => {
    const directory = mkdtempSync(join(tmpdir(), "nexus-intent-confirm-"))
    try {
      await writeWorkspaceSelection({ configDirectory: directory, projectID: "local-project", selectedAt: 1 })
      const request = "workspace selection bookmark clear kar do"
      const inspection = inspectIntent(request)
      const withoutConfirmation = await executeLocalIntent(request, { workspaceSelectionDirectory: directory })

      expect(inspection).toMatchObject({ category: "workspace-mutation", execution: "not-run" })
      expect(withoutConfirmation).toMatchObject({ execution: "blocked" })
      expect(withoutConfirmation.reason).toContain("--confirm-local")
      expect((await readWorkspaceSelection(directory))?.projectID).toBe("local-project")

      const confirmed = await executeLocalIntent(request, { confirmLocal: true, workspaceSelectionDirectory: directory })
      expect(confirmed).toMatchObject({ execution: "executed" })
      expect(confirmed.result).toContain("Cleared the local workspace selection bookmark")
      expect(await readWorkspaceSelection(directory)).toBeUndefined()
      expect(formatIntentExecution(confirmed, "table")).toContain("completed locally (confirmed mutation)")
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test("does not suggest agent creation or selection for an inspection-only role request", () => {
    expect(inspectIntent("planner ko active select kar do")).toEqual({
      category: "unknown",
      confidence: "none",
      execution: "not-run",
    })
  })

  test("does not suggest adding or checking an API key from inspection-only wording", () => {
    expect(inspectIntent("nayi API key add kar do")).toEqual({
      category: "unknown",
      confidence: "none",
      execution: "not-run",
    })
    expect(inspectIntent("API key active check kar do")).toEqual({
      category: "unknown",
      confidence: "none",
      execution: "not-run",
    })
  })

  test("executes only high-confidence API local inspection through the explicit allowlist", async () => {
    const result = await executeLocalIntent("API key readiness dikhao")

    expect(result.execution).toBe("executed")
    expect(result.result).toContain("API readiness (local observations only)")
    expect(result.result).toContain("No provider contacted, key checked, vault changed, route selected, or task started")
    expect(formatIntentExecution(result, "table")).toContain("completed locally (read-only)")
  })

  test("executes named specialist-role inspection but blocks an unnamed role detail", async () => {
    const reviewer = await executeLocalIntent("reviewer agent role policy dikhao")
    const unnamed = await executeLocalIntent("agent role details dikhao")

    expect(reviewer.execution).toBe("executed")
    expect(reviewer.result).toContain("Role: reviewer")
    expect(unnamed.execution).toBe("blocked")
    expect(unnamed.reason).toContain("Name one supported role")
  })

  test("runs bounded device readiness locally but blocks sensitive and non-allowlisted routes", async () => {
    const device = await executeLocalIntent("Termux device readiness memory storage dikhao")
    const sensitive = await executeLocalIntent("API key: sk_very-secret-value-123456789")
    const workspace = await executeLocalIntent("workspace ke project list dikhao")

    expect(device.execution).toBe("executed")
    expect(device.result).toContain("Observed local signals only")
    expect(sensitive).toMatchObject({ category: "sensitive-input", execution: "blocked" })
    expect(JSON.stringify(sensitive)).not.toContain("very-secret")
    expect(workspace).toMatchObject({ category: "workspace", execution: "blocked" })
    expect(formatIntentExecution(workspace, "table")).toContain("not in the explicit read-only execution allowlist")
  })

  test("executes fixed-root instruction transparency without accepting a user-supplied path", async () => {
    const explain = await executeLocalIntent("NEXUS.md instruction precedence explain karo")
    const status = await executeLocalIntent("instructions status dikhao")

    expect(explain.execution).toBe("executed")
    expect(explain.result).toContain("This command never prints instruction contents")
    expect(status.execution).toBe("executed")
    expect(status.result).toContain("Scope: names and paths only; file contents are not read")
    expect(status.result).not.toContain("NEXUS.md instruction precedence explain karo")
  })

  test("executes workspace selection bookmark inspection but keeps workspace list blocked", async () => {
    const selected = await executeLocalIntent("current selected workspace dikhao")
    const listed = await executeLocalIntent("workspace ke project list dikhao")

    expect(selected.execution).toBe("executed")
    expect(selected.result).toContain("This does not affect the current shell directory")
    expect(listed.execution).toBe("blocked")
  })

  test("executes a bounded current-project translation plan only for an explicit language pair", async () => {
    const plan = await executeLocalIntent("TypeScript se Python translation plan banao")
    const ambiguous = await executeLocalIntent("TypeScript Python Go translation plan banao")

    expect(plan).toMatchObject({ category: "translation", execution: "executed" })
    expect(plan.result).toContain("NEXUS Translation Plan (manual review required; not executed)")
    expect(plan.result).toContain("This command does not read file contents, call a model, or write translated output")
    expect(ambiguous.execution).toBe("blocked")
    expect(ambiguous.reason).toContain("exactly two distinct supported languages")
  })

  test("executes informational local-model guidance and redacted known-alias route preview only", async () => {
    const localCatalog = await executeLocalIntent("local model catalog dikhao")
    const route = await executeLocalIntent("deepseek model route dikhao")
    const unknownRoute = await executeLocalIntent("my-private-model route dikhao")

    expect(localCatalog).toMatchObject({ category: "local-model", execution: "executed" })
    expect(localCatalog.result).toContain("no download or local-model runtime was started")
    expect(route).toMatchObject({ category: "model-route", execution: "executed" })
    expect(route.result).toContain("Preview only: no provider contacted, key validated, vault changed, route selected, or task started")
    expect(unknownRoute).toMatchObject({ category: "unknown", execution: "blocked" })
  })
})
