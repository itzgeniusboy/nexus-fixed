import { describe, expect, test } from "bun:test"
import { formatIntentInspection, inspectIntent } from "../../src/cli/cmd/intent"

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
})
