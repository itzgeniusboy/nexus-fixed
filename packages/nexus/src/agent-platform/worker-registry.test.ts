import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { WorkerRequest } from "../agent/master"
import { createMasterWorkerRegistry } from "./worker-registry"

function request(kind: WorkerRequest["step"]["kind"], workspace: string, objective = "inspect") {
  return {
    taskID: "task-1",
    step: { id: kind, kind, title: objective, status: "dispatching", dependsOn: [], attempts: 1, maxAttempts: 2 },
    objective,
    workspace,
    queuedInstructions: [],
    capabilities: {
      platform: "linux",
      architecture: "x64",
      termux: false,
      git: true,
      github: false,
      browserHandoff: true,
      browserHttpInspection: false,
      browserAutomation: false,
      webRuntime: true,
      android: false,
      apkBuild: false,
      packageManagers: ["bun"],
    },
  } satisfies WorkerRequest
}

describe("Master worker registry", () => {
  test("runs typed read-only Git inspection and reports approval boundary", async () => {
    const registry = createMasterWorkerRegistry({
      inspectGit: async () => ({ branch: "main", clean: true, changedFiles: [], summary: "Repository inspected" }),
    })
    const result = await registry.run(request("git", process.cwd()))

    expect(result.summary).toBe("Repository inspected")
    expect(result.verification).toContain("Only read-only inspection was requested by this worker.")
  })

  test("does not execute browser automation when capability is unavailable", async () => {
    let called = false
    const registry = createMasterWorkerRegistry({
      inspectBrowser: async () => {
        called = true
        return { url: "https://example.com", summary: "inspected" }
      },
    })
    const result = await registry.run(request("browser", process.cwd(), "inspect https://example.com"))

    expect(called).toBe(false)
    expect(result.summary).toMatch(/unavailable/i)
  })

  test("dispatches only detected project checks through the typed operation", async () => {
    const root = await mkdtemp(join(tmpdir(), "nexus-registry-web-"))
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ scripts: { test: "vitest", build: "vite build" }, dependencies: { vite: "latest" } }),
    )
    let commands: readonly string[] = []
    const registry = createMasterWorkerRegistry({
      runProjectChecks: async (input) => {
        commands = input.commands
        return input.commands.map((command) => ({ command, exitCode: 0 }))
      },
    })
    const result = await registry.run(request("web", root, "run web checks"))

    expect(commands).toEqual(["npm run test", "npm run build"])
    expect(result.summary).toBe("web checks completed successfully.")
  })
})
