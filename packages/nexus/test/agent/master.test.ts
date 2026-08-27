import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { MasterAgent, isRiskyAction, suggestMasterSteps } from "@/agent/master"

const workspaces: string[] = []

afterEach(async () => {
  while (workspaces.length) await rm(workspaces.pop()!, { recursive: true, force: true })
})

async function workspace() {
  const path = await mkdtemp(join(tmpdir(), "nexus-master-agent-"))
  workspaces.push(path)
  return path
}

describe("MasterAgent", () => {
  test("suggests a coordinated specialist plan from the objective", () => {
    const steps = suggestMasterSteps(
      "Fix the web app, inspect it in the browser, test the APK, and prepare a GitHub PR",
    )

    expect(steps.map((step) => step.kind)).toEqual(["browser", "web", "android", "git", "coder", "reviewer", "tester"])
    expect(steps.at(-1)?.dependsOn).toEqual(["review"])
  })

  test("autoPlan persists the generated workflow", async () => {
    const root = await workspace()
    const agent = new MasterAgent({ workspace: root })
    await agent.create("Research and fix a browser web app")

    const state = await agent.autoPlan()
    expect(state.status).toBe("planning")
    expect(state.steps.map((step) => step.id)).toEqual(["research", "browser", "web", "coder", "review", "test"])
  })

  test("detects risky actions without exposing secrets", () => {
    expect(isRiskyAction("git push origin main")).toBe(true)
    expect(isRiskyAction("sudo apt install gradle")).toBe(true)
    expect(isRiskyAction("read package.json and run tests")).toBe(false)
  })

  test("checkpoints a plan and retries a failed worker within a bounded budget", async () => {
    const root = await workspace()
    const agent = new MasterAgent({ workspace: root, maxStepAttempts: 2 })
    await agent.create("Fix and test the project")
    await agent.plan([{ id: "test", kind: "tester", title: "Run tests", dependsOn: [] }])

    let attempts = 0
    const state = await agent.executeStep("test", async () => {
      attempts += 1
      if (attempts === 1) throw new Error("temporary test runner failure")
      return { summary: "Focused tests passed", verification: ["bun test"] }
    })

    expect(attempts).toBe(2)
    expect(state.status).toBe("completed")
    expect(state.steps[0]?.status).toBe("completed")
    expect(state.steps[0]?.attempts).toBe(2)
  })

  test("queues user instructions and resumes an interrupted active task safely", async () => {
    const root = await workspace()
    const statePath = join(root, ".nexus", "task.json")
    const first = new MasterAgent({ workspace: root, statePath })
    await first.create("Inspect a web app")
    await first.plan([{ id: "browser", kind: "browser", title: "Inspect page", dependsOn: [] }])
    await first.enqueueInstruction("Also check the mobile layout")
    await first.transition("running")

    const second = new MasterAgent({ workspace: root, statePath })
    const recovered = await second.resume()
    expect(recovered?.status).toBe("paused")
    expect(recovered?.queuedInstructions).toEqual(["Also check the mobile layout"])
    expect(recovered?.objective).toBe("Inspect a web app")
  })
})
