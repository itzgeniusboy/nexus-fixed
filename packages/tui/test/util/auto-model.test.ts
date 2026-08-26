import { expect, test } from "bun:test"
import { resolveAutoModel } from "../../src/util/auto-model"
import type { Provider } from "@nexus-ai/sdk/v2"

function provider(id: string, models: Partial<Provider["models"]>): Provider {
  return {
    id,
    name: id,
    source: "config",
    env: [],
    options: {},
    models: models as Provider["models"],
  }
}

function model(overrides: Record<string, unknown>) {
  return {
    id: "m",
    providerID: "p",
    api: { id: "m", url: "", npm: "" },
    name: "M",
    release_date: "2026-01-01",
    headers: {},
    options: {},
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: false,
      toolcall: true,
      interleaved: false as const,
      input: { text: true, audio: false, image: false, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
    },
    cost: { input: 0.001, output: 0.002, cache: { read: 0, write: 0 } },
    limit: { context: 128_000, output: 8_000 },
    status: "active" as const,
    ...overrides,
  }
}

const providers = [
  provider("cheap", {
    cheapchat: model({ id: "cheapchat", cost: { input: 0.00001, output: 0.00002, cache: { read: 0, write: 0 } } }),
  }),
  provider("strong", {
    bigreasoner: model({
      id: "bigreasoner",
      capabilities: model({}).capabilities,
      reasoning: undefined,
    }),
  }),
]

test("plain chat picks the cheapest capable model", () => {
  const result = resolveAutoModel({ task: "hii kaisa hai", providers })
  expect(result?.providerID).toBe("cheap")
  expect(result?.modelID).toBe("cheapchat")
  expect(result?.reason).toBe("chat")
})

test("vision tasks only consider image-capable models", () => {
  const vision = provider("vision", {
    eyes: model({
      id: "eyes",
      capabilities: {
        ...model({}).capabilities,
        attachment: true,
        input: { ...model({}).capabilities.input, image: true },
      },
    }),
  })
  const result = resolveAutoModel({ task: "is screenshot me kya hai", providers: [providers[0], vision] })
  expect(result?.providerID).toBe("vision")
  expect(result?.modelID).toBe("eyes")
})

test("image attachments trigger vision routing without keywords", () => {
  const vision = provider("vision", {
    eyes: model({
      id: "eyes",
      capabilities: {
        ...model({}).capabilities,
        attachment: true,
        input: { ...model({}).capabilities.input, image: true },
      },
    }),
  })
  const result = resolveAutoModel({ task: "what is this", hasImage: true, providers: [providers[0], vision] })
  expect(result?.providerID).toBe("vision")
})

test("returns undefined when no model satisfies the requirements", () => {
  const result = resolveAutoModel({ task: "analyze the architecture trade-offs", providers: [providers[0]] })
  expect(result).toBeUndefined()
})

test("deprecated models are never selected", () => {
  const stale = provider("stale", {
    old: model({ id: "old", status: "deprecated", cost: { input: 0, output: 0, cache: { read: 0, write: 0 } } }),
  })
  const result = resolveAutoModel({ task: "hii", providers: [stale] })
  expect(result).toBeUndefined()
})
