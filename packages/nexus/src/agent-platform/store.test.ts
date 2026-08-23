import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { AgentPlatformStore } from "./store"

const roots: string[] = []

function makeStore() {
  const root = mkdtempSync(join(tmpdir(), "nexus-agent-platform-"))
  roots.push(root)
  return new AgentPlatformStore({ path: join(root, "agent-platform.db") })
}

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true })
})

describe("AgentPlatformStore", () => {
  test("stores scope-isolated redacted memory without duplicate active records", () => {
    const store = makeStore()
    const first = store.addMemory({ scope: "project", scopeId: "alpha", kind: "preference", content: "Use key sk-ant-api03-abcdefghij1234567890", confidence: 0.8 })
    const second = store.addMemory({ scope: "project", scopeId: "alpha", kind: "preference", content: "Use key sk-ant-api03-abcdefghij1234567890", confidence: 0.9 })
    expect(first.id).toBe(second.id)
    expect(first.content).not.toContain("sk-ant")
    expect(store.searchMemory("use key", "project", "alpha")).toHaveLength(1)
    expect(store.searchMemory("use key", "project", "beta")).toHaveLength(0)
    store.close()
  })

  test("keeps learning proposed until an explicit approval creates a skill revision", () => {
    const store = makeStore()
    const proposal = store.proposeLearning({ runId: "run-1", title: "Safe API checks", summary: "Mask keys", skillDraft: "Always mask api_key=secret", evidence: ["api_key=secret"] })
    expect(store.listLearning("proposed")).toHaveLength(1)
    store.approveLearning(proposal.id)
    expect(store.listLearning("approved")).toHaveLength(1)
    expect(store.listLearning("approved")[0]?.skillDraft).not.toContain("api_key=secret")
    store.close()
  })

  test("creates disabled schedules that require a later explicit enable action", () => {
    const store = makeStore()
    const schedule = store.createSchedule({ name: "daily-review", expression: "0 9 * * *", payload: "review project" })
    expect(schedule.enabled).toBe(false)
    expect(store.listSchedules()[0]?.enabled).toBe(false)
    store.close()
  })

  test("records bounded durable subagent plans without starting background work", () => {
    const store = makeStore()
    const first = store.createRun({ idempotencyKey: "interactive:demo", policy: { maxChildren: 2, maxParallel: 3, budgetClass: "low" } })
    const replay = store.createRun({ idempotencyKey: "interactive:demo", policy: { maxChildren: 12, maxParallel: 12 } })
    expect(first.id).toBe(replay.id)
    expect(first.status).toBe("queued")
    expect(first.policy).toEqual({ maxChildren: 2, maxParallel: 3, budgetClass: "low" })
    expect(store.listRuns()).toHaveLength(1)
    store.close()
  })
})
