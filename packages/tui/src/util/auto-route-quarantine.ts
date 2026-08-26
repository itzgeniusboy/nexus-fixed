import type { AssistantMessage } from "@nexus-ai/sdk/v2"
import { routeKey } from "./auto-model"

const QUARANTINE_KEY = "auto_route_quarantine"

type KV = {
  get(key: string): unknown
  set(key: string, value: unknown): void
}

// A 410/Gone runtime result means the exact model route is EOL; it is recorded
// locally so Auto stops selecting it. Manual picks never consult this list.
export function goneRoute(message: AssistantMessage) {
  const error = message.error
  if (!error || error.name !== "APIError" || error.data.statusCode !== 410) return undefined
  return { providerID: message.providerID, modelID: message.modelID }
}

export function quarantinedRoutes(kv: KV) {
  const value = kv.get(QUARANTINE_KEY)
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

export function quarantineRoute(kv: KV, providerID: string, modelID: string) {
  const key = routeKey(providerID, modelID)
  const routes = quarantinedRoutes(kv)
  if (routes.includes(key)) return
  kv.set(QUARANTINE_KEY, [...routes, key])
}
