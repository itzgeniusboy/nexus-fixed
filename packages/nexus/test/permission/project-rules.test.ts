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
})
