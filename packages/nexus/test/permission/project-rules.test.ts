import { describe, expect, test } from "bun:test"
import { Permission } from "../../src/permission"

describe("project permission rules", () => {
  test("applies project config as an explicit baseline while retaining default ask", () => {
    const rules = Permission.projectRules({ bash: { "git status": "allow", "rm *": "deny" } }, [], [])
    expect(Permission.evaluate("bash", "git status", rules).action).toBe("allow")
    expect(Permission.evaluate("bash", "rm build", rules).action).toBe("deny")
    expect(Permission.evaluate("webfetch", "https://example.test", rules).action).toBe("ask")
  })

  test("agent and temporary session controls override project baseline without exposing arguments or secrets", () => {
    const rules = Permission.projectRules(
      { bash: "deny", edit: "ask" },
      [{ permission: "bash", pattern: "git *", action: "allow" }],
      [{ permission: "edit", pattern: "src/**", action: "allow" }],
    )
    expect(Permission.evaluate("bash", "git status", rules).action).toBe("allow")
    expect(Permission.evaluate("bash", "curl https://example.test", rules).action).toBe("deny")
    expect(Permission.evaluate("edit", "src/app.ts", rules).action).toBe("allow")
  })

  test("explains only action and policy layer, never the matched command or pattern", () => {
    const decision = Permission.explainDecision({
      permission: "bash",
      pattern: "curl https://example.test?token=secret-value",
      project: Permission.fromConfig({ bash: "deny" }),
      agent: [{ permission: "bash", pattern: "git *", action: "allow" }],
      session: [],
    })
    expect(decision).toEqual({ permission: "bash", action: "deny", source: "project" })
    expect(JSON.stringify(decision)).not.toContain("secret-value")
  })
})
