import type { AssistantMessage } from "@nexus-ai/sdk/v2"
import { routeKey } from "./auto-model"

const QUARANTINE_KEY = "auto_route_quarantine"

type KV = {
  get(key: string): unknown
  set(key: string, value: unknown): void
}

export type GoneNotice = {
  title: string
  message: string
}

// A 410/Gone runtime result means the exact model route is EOL; it is recorded
// locally so Auto stops selecting it. Only Auto-resolved routes are ever
// quarantined: a manually selected model keeps precedence even when it fails,
// so the user's explicit choice is never silently switched.
const autoRoutes = new Map<string, Set<string>>()

export function markAutoRoute(sessionID: string, providerID: string, modelID: string) {
  const routes = autoRoutes.get(sessionID) ?? new Set<string>()
  routes.add(routeKey(providerID, modelID))
  autoRoutes.set(sessionID, routes)
}

function isAutoRoute(sessionID: string, providerID: string, modelID: string) {
  return autoRoutes.get(sessionID)?.has(routeKey(providerID, modelID)) === true
}

type GoneCandidate = {
  sessionID: string
  role: string
  error?: AssistantMessage["error"]
  providerID?: string
  modelID?: string
}

export function goneRoute(message: Pick<AssistantMessage, "error" | "providerID" | "modelID">) {
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

type Notify = (notice: { title?: string; message: string; variant: "info" | "success" | "warning" | "error"; duration?: number }) => void

/**
 * Terminal lifecycle for a failed turn's route at the real message-event seam:
 * an Auto-resolved 410/Gone quarantines the exact route exactly once and emits
 * one truthful actionable notice; the failed request itself stays preserved in
 * the transcript for explicit user retry, and future Auto submissions fall back
 * to another configured compatible route at the existing submit boundary.
 */
export function recordGoneRoute(
  message: GoneCandidate,
  deps: { kv: KV; notify: Notify },
): { quarantined: boolean } | undefined {
  if (message.role !== "assistant") return undefined
  const gone = goneRoute({
    error: message.error,
    providerID: message.providerID ?? "",
    modelID: message.modelID ?? "",
  })
  if (!gone) return undefined
  if (!isAutoRoute(message.sessionID, gone.providerID, gone.modelID)) return { quarantined: false }
  const first = !quarantinedRoutes(deps.kv).includes(routeKey(gone.providerID, gone.modelID))
  if (!first) return { quarantined: true }
  quarantineRoute(deps.kv, gone.providerID, gone.modelID)
  deps.notify({
    title: "Model unavailable",
    message: `${routeKey(gone.providerID, gone.modelID)} returned 410 (EOL). Auto will skip this route; resend your request or pick another model.`,
    variant: "warning",
    duration: 6000,
  })
  return { quarantined: true }
}
