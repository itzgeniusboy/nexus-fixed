import { expect, test } from "bun:test"
import { formatApiVaultList } from "../../src/cli/cmd/api"

test("API vault list labels only NEXUS-observed usage and never claims provider account state", () => {
  const output = formatApiVaultList({
    vaultPath: "/tmp/nexus/api-keys.json",
    autoRotate: true,
    budget: { maxRequestsPerTask: 3, maxTokensPerTask: 1200, maxRequestsPerDay: 12, maxTokensPerDay: 4800 },
    rows: [
      {
        provider: "groq",
        index: 1,
        label: "default",
        key: "gsk_abc***xyz",
        status: "active",
        usage: { todayRequests: 2, todayInputTokens: 40, todayOutputTokens: 60 },
      },
    ],
    now: Date.UTC(2026, 7, 25),
  })

  expect(output).toContain("NEXUS observed today")
  expect(output).toContain("2 req / 100 tok")
  expect(output).toContain("not a provider balance, remaining quota, account token allocation, or cost reading")
  expect(output).toContain("gsk_abc***xyz")
})
