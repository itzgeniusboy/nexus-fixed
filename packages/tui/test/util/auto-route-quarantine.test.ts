import { expect, test } from "bun:test"
import { goneRoute, quarantinedRoutes, quarantineRoute } from "../../src/util/auto-route-quarantine"
import type { AssistantMessage } from "@nexus-ai/sdk/v2"

function memoryKV(initial: Record<string, unknown> = {}) {
  const data = structuredClone(initial)
  return {
    get: (key: string) => data[key],
    set: (key: string, value: unknown) => {
      data[key] = value
    },
    data,
  }
}

function assistantMessage(overrides: Partial<AssistantMessage> = {}): AssistantMessage {
  return {
    id: "msg_1",
    sessionID: "s1",
    role: "assistant",
    time: { created: 0 },
    parentID: "u1",
    modelID: "m",
    providerID: "p",
    mode: "default",
    ...overrides,
  } as AssistantMessage
}

test("a 410/Gone result marks its exact route gone", () => {
  const message = assistantMessage({
    providerID: "anthropic",
    modelID: "legacy-model",
    error: {
      name: "APIError",
      data: { message: "model retired", statusCode: 410, isRetryable: false },
    },
  })
  expect(goneRoute(message)).toEqual({ providerID: "anthropic", modelID: "legacy-model" })
})

test("other runtime failures are not treated as EOL", () => {
  for (const statusCode of [429, 500, 404, undefined]) {
    const message = assistantMessage({
      error: { name: "APIError", data: { message: "boom", statusCode, isRetryable: false } },
    })
    expect(goneRoute(message)).toBeUndefined()
  }
  expect(goneRoute(assistantMessage({ error: { name: "MessageAbortedError", data: { message: "aborted" } } }))).toBeUndefined()
  expect(goneRoute(assistantMessage())).toBeUndefined()
})

test("quarantine persists per route and never duplicates", () => {
  const kv = memoryKV()
  quarantineRoute(kv, "p", "m")
  quarantineRoute(kv, "p", "m")
  quarantineRoute(kv, "q", "n")
  expect(quarantinedRoutes(kv)).toEqual(["p/m", "q/n"])
})

test("corrupted quarantine state degrades to an empty list without throwing", () => {
  expect(quarantinedRoutes(memoryKV({ auto_route_quarantine: "junk" }))).toEqual([])
  expect(quarantinedRoutes(memoryKV({ auto_route_quarantine: [1, "p/m", null] }))).toEqual(["p/m"])
})
