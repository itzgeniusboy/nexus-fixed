import fs from "fs"
import os from "os"
import path from "path"
import { PROVIDER_CONTRACTS, REGISTRY_PROVIDER_IDS, contractFor, type ProviderContract } from "./providers"

export const API_PROVIDERS = REGISTRY_PROVIDER_IDS

const PROVIDER_ALIASES: Record<string, string> = Object.fromEntries(
  Object.values(PROVIDER_CONTRACTS).flatMap((contract) => (contract.aliases ?? []).map((alias) => [alias, contract.id])),
)
export type ApiProvider = (typeof API_PROVIDERS)[number]
export type ApiKeyStatus = "active" | "rate_limited" | "invalid" | "suspended" | "unknown"

export type ApiKeySource = "ui" | "auth" | "cli"

export interface ApiKeyEntry {
  key: string
  label: string
  added: string
  status: ApiKeyStatus
  failures: number
  source?: ApiKeySource
  suspendedUntil?: string
  lastChecked?: string
}

export interface ProviderUsage {
  todayRequests: number
  todayInputTokens: number
  todayOutputTokens: number
  lastUsed?: string
}

export interface ApiVaultData {
  providers: Record<string, ApiKeyEntry[]>
  usage: Record<string, ProviderUsage>
  autoRotate: boolean
  fallbackToLocal: boolean
}

const home = () => process.env.HOME || os.homedir()
export const apiVaultPath = () => path.join(home(), ".nexus", "api-vault.json")
export const apiUsagePath = () => path.join(home(), ".nexus", "api-usage.json")

function emptyVault(): ApiVaultData {
  return { providers: {}, usage: {}, autoRotate: true, fallbackToLocal: true }
}

function parseObject(source: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(source)
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function normalizeEntry(value: unknown): ApiKeyEntry | undefined {
  if (!value || typeof value !== "object") return undefined
  const item = value as Record<string, unknown>
  if (typeof item.key !== "string" || !item.key.trim()) return undefined
  const status = item.status
  const validStatus: ApiKeyStatus =
    status === "active" || status === "rate_limited" || status === "invalid" || status === "suspended"
      ? status
      : "unknown"
  const source = item.source === "ui" || item.source === "auth" || item.source === "cli" ? item.source : undefined
  return {
    key: item.key.trim(),
    label: typeof item.label === "string" && item.label.trim() ? item.label.trim() : "default",
    added: typeof item.added === "string" ? item.added : new Date().toISOString().slice(0, 10),
    status: validStatus,
    failures: typeof item.failures === "number" && Number.isFinite(item.failures) ? item.failures : 0,
    ...(source ? { source } : {}),
    ...(typeof item.suspendedUntil === "string" ? { suspendedUntil: item.suspendedUntil } : {}),
    ...(typeof item.lastChecked === "string" ? { lastChecked: item.lastChecked } : {}),
  }
}

function normalizeVault(value: Record<string, unknown>): ApiVaultData {
  const providers: Record<string, ApiKeyEntry[]> = {}
  const rawProviders =
    value.providers && typeof value.providers === "object" ? (value.providers as Record<string, unknown>) : {}
  for (const [provider, entries] of Object.entries(rawProviders)) {
    if (!Array.isArray(entries)) continue
    providers[provider.toLowerCase()] = entries
      .map(normalizeEntry)
      .filter((entry): entry is ApiKeyEntry => Boolean(entry))
  }
  const usage: Record<string, ProviderUsage> = {}
  const rawUsage = value.usage && typeof value.usage === "object" ? (value.usage as Record<string, unknown>) : {}
  for (const [provider, raw] of Object.entries(rawUsage)) {
    const item = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}
    usage[provider.toLowerCase()] = {
      todayRequests:
        typeof item.todayRequests === "number"
          ? item.todayRequests
          : typeof item.today_requests === "number"
            ? item.today_requests
            : 0,
      todayInputTokens: typeof item.todayInputTokens === "number" ? item.todayInputTokens : 0,
      todayOutputTokens: typeof item.todayOutputTokens === "number" ? item.todayOutputTokens : 0,
      ...(typeof item.lastUsed === "string" ? { lastUsed: item.lastUsed } : {}),
    }
  }
  return {
    providers,
    usage,
    autoRotate: value.autoRotate !== false,
    fallbackToLocal: value.fallbackToLocal !== false,
  }
}

export function loadApiVault(): ApiVaultData {
  const file = apiVaultPath()
  if (!fs.existsSync(file)) return emptyVault()
  return normalizeVault(parseObject(fs.readFileSync(file, "utf8")))
}

export function saveApiVault(vault: ApiVaultData): void {
  const file = apiVaultPath()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(vault, null, 2)}\n`, { mode: 0o600 })
  try {
    fs.chmodSync(file, 0o600)
  } catch {
    // Termux filesystems may not implement chmod; the file is still private by default.
  }
  saveUsage(vault.usage)
}

export function saveUsage(usage: Record<string, ProviderUsage>): void {
  const file = apiUsagePath()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(usage, null, 2)}\n`, { mode: 0o600 })
  try {
    fs.chmodSync(file, 0o600)
  } catch {
    // Best effort only.
  }
}

export function normalizeProvider(provider: string): ApiProvider | undefined {
  const raw = provider.trim().toLowerCase().replace(/[\s_]+/g, "-")
  const normalized = PROVIDER_ALIASES[raw] ?? raw
  if (normalized === "google") return "gemini"
  return (API_PROVIDERS as readonly string[]).includes(normalized) ? (normalized as ApiProvider) : undefined
}

export function maskApiKey(key: string): string {
  const value = key.trim()
  if (value.length <= 8) return "********"
  return `${value.slice(0, Math.min(7, value.length - 3))}***${value.slice(-3)}`
}

export function ensureApiKey(providerInput: string, key: string, label = "auth"): ApiKeyEntry | undefined {
  const provider = normalizeProvider(providerInput)
  const value = key.trim()
  if (!provider || !value) return undefined
  const vault = loadApiVault()
  const entries = vault.providers[provider] ?? []
  const existing = entries.find((entry) => entry.key === value)
  if (existing) return existing
  const entry: ApiKeyEntry = {
    key: value,
    label: label.trim() || "auth",
    added: new Date().toISOString().slice(0, 10),
    status: "unknown",
    failures: 0,
    source: "auth",
  }
  vault.providers[provider] = [...entries, entry]
  saveApiVault(vault)
  return entry
}

export function addApiKey(
  providerInput: string,
  key: string,
  label = "default",
  source: ApiKeySource = "cli",
): ApiKeyEntry {
  const provider = normalizeProvider(providerInput)
  if (!provider) throw new Error(`Unsupported provider: ${providerInput}. Supported: ${API_PROVIDERS.join(", ")}`)
  if (!key.trim()) throw new Error("API key cannot be empty")
  const vault = loadApiVault()
  const entries = vault.providers[provider] ?? []
  const existing = entries.find((entry) => entry.key === key.trim())
  if (existing) {
    existing.label = label.trim() || existing.label
    existing.source ??= source
    existing.status = "active"
    existing.failures = 0
    saveApiVault(vault)
    return existing
  }
  const entry: ApiKeyEntry = {
    key: key.trim(),
    label: label.trim() || "default",
    added: new Date().toISOString().slice(0, 10),
    status: "active",
    failures: 0,
    source,
  }
  vault.providers[provider] = [...entries, entry]
  saveApiVault(vault)
  return entry
}

export function removeManagedApiKey(providerInput: string, key: string): boolean {
  const provider = normalizeProvider(providerInput)
  if (!provider) return false
  const vault = loadApiVault()
  const entries = vault.providers[provider] ?? []
  const value = key.trim()
  const index = entries.findIndex(
    (entry) =>
      entry.key === value &&
      (entry.source === "ui" || entry.source === "auth" || entry.label === "ui" || entry.label === "auth"),
  )
  if (index < 0) return false
  vault.providers[provider] = entries.filter((_, position) => position !== index)
  if (vault.providers[provider].length === 0) delete vault.providers[provider]
  saveApiVault(vault)
  return true
}

export function removeApiKey(providerInput: string, index: number): ApiKeyEntry {
  const provider = normalizeProvider(providerInput)
  if (!provider) throw new Error(`Unsupported provider: ${providerInput}`)
  if (!Number.isInteger(index) || index < 1) throw new Error("Key index must be a positive number")
  const vault = loadApiVault()
  const entries = vault.providers[provider] ?? []
  const removed = entries[index - 1]
  if (!removed) throw new Error(`No ${provider} key exists at index ${index}`)
  vault.providers[provider] = entries.filter((_, position) => position !== index - 1)
  if (vault.providers[provider].length === 0) delete vault.providers[provider]
  saveApiVault(vault)
  return removed
}

function invalidateCachedVaultStatus(): void {
  cachedVaultStatus = null
  lastVaultCacheTime = 0
}

export function updateApiKeyStatus(providerInput: string, key: string, status: ApiKeyStatus, error?: unknown): void {
  const provider = normalizeProvider(providerInput)
  if (!provider) return
  const vault = loadApiVault()
  const entry = (vault.providers[provider] ?? []).find((candidate) => candidate.key === key)
  if (!entry) {
    const previous = cachedConfiguredStatus[key]
    const failures = status === "active" ? 0 : (previous?.failures ?? 0) + 1
    cachedConfiguredStatus[key] = {
      key,
      label: previous?.label ?? "config",
      added: previous?.added ?? new Date().toISOString().slice(0, 10),
      status: failures >= 3 && status !== "active" ? "suspended" : status,
      failures,
      lastChecked: new Date().toISOString(),
      ...(failures >= 3 && status !== "active"
        ? { suspendedUntil: new Date(Date.now() + 60 * 60 * 1000).toISOString() }
        : {}),
    }
    return
  }
  entry.status = status
  entry.lastChecked = new Date().toISOString()
  if (status === "active") {
    entry.failures = 0
    delete entry.suspendedUntil
  } else if (status === "rate_limited" || status === "invalid") {
    entry.failures += 1
    if (entry.failures >= 3) {
      entry.status = "suspended"
      entry.suspendedUntil = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    }
  }
  void error
  saveApiVault(vault)
  invalidateCachedVaultStatus()
}

export function recordApiUsage(providerInput: string, inputTokens: number, outputTokens: number): void {
  const provider = normalizeProvider(providerInput) ?? providerInput.toLowerCase()
  const vault = loadApiVault()
  const usage = vault.usage[provider] ?? { todayRequests: 0, todayInputTokens: 0, todayOutputTokens: 0 }
  usage.todayRequests += 1
  usage.todayInputTokens += Math.max(0, Math.round(inputTokens))
  usage.todayOutputTokens += Math.max(0, Math.round(outputTokens))
  usage.lastUsed = new Date().toISOString()
  vault.usage[provider] = usage
  saveApiVault(vault)
}

export function availableApiKeys(providerInput: string): ApiKeyEntry[] {
  const provider = normalizeProvider(providerInput)
  if (!provider) return []
  const now = Date.now()
  const vault = loadApiVault()
  return (vault.providers[provider] ?? []).filter((entry) => {
    if (entry.status !== "suspended") return true
    return !entry.suspendedUntil || Date.parse(entry.suspendedUntil) <= now
  })
}

export function apiVaultRows(): Array<{
  provider: string
  index: number
  label: string
  key: string
  status: ApiKeyStatus
  usage: ProviderUsage
}> {
  const vault = loadApiVault()
  return Object.entries(vault.providers).flatMap(([provider, entries]) =>
    entries.map((entry, index) => ({
      provider,
      index: index + 1,
      label: entry.label,
      key: maskApiKey(entry.key),
      status: entry.status,
      usage: vault.usage[provider] ?? { todayRequests: 0, todayInputTokens: 0, todayOutputTokens: 0 },
    })),
  )
}

export function apiVaultPublicRows() {
  const vault = loadApiVault()
  return Object.entries(vault.providers).map(([provider, entries]) => ({
    provider,
    keys: entries.map((entry, index) => ({
      index: index + 1,
      label: entry.label,
      key: maskApiKey(entry.key),
      status: entry.status,
      failures: entry.failures,
      added: entry.added,
      ...(entry.lastChecked ? { lastChecked: entry.lastChecked } : {}),
      ...(entry.suspendedUntil ? { suspendedUntil: entry.suspendedUntil } : {}),
      todayRequests: vault.usage[provider]?.todayRequests ?? 0,
      todayInputTokens: vault.usage[provider]?.todayInputTokens ?? 0,
      todayOutputTokens: vault.usage[provider]?.todayOutputTokens ?? 0,
    })),
  }))
}

const discoveredModelsCache = new Map<string, { expiresAt: number; models: string[] }>()

function modelNames(value: unknown): string[] {
  if (!value || typeof value !== "object") return []
  const root = value as Record<string, unknown>
  const isGemini = Array.isArray(root.models)
  const rows = Array.isArray(root.data) ? root.data : isGemini ? root.models : []
  return rows
    .map((item) => {
      if (typeof item === "string") return item
      if (!item || typeof item !== "object") return undefined
      const row = item as Record<string, unknown>
      if (
        isGemini &&
        Array.isArray(row.supportedGenerationMethods) &&
        !row.supportedGenerationMethods.includes("generateContent")
      )
        return undefined
      const name = typeof row.id === "string" ? row.id : typeof row.name === "string" ? row.name : undefined
      const normalized = name?.replace("models/", "")
      if (
        normalized &&
        /(?:tts|native-audio|audio|image|video|embedding|embed|speech|lyria|music|deep-research|computer-use|robotics|banana)/i.test(
          normalized,
        )
      ) {
        return undefined
      }
      return normalized
    })
    .filter((name): name is string => Boolean(name))
}

export async function discoverProviderModels(
  providerInput: string,
  key: string,
): Promise<{ status: ApiKeyStatus; models: string[]; code?: number }> {
  const provider = normalizeProvider(providerInput)
  const contract = contractFor(providerInput)
  if (!provider || !contract) return { status: "unknown", models: [] }
  const cacheKey = `${provider}:${key}`
  const cached = discoveredModelsCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return { status: "active", models: cached.models }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)
  try {
    const headers = authHeadersFor(contract, key)
    const url =
      contract.auth === "query" ? `${contract.modelsEndpoint}?key=${encodeURIComponent(key)}` : contract.modelsEndpoint
    const response = await fetch(url, { headers, signal: controller.signal })
    if (response.status === 401 || response.status === 403)
      return { status: "invalid", models: [], code: response.status }
    if (response.status === 429) return { status: "rate_limited", models: [], code: response.status }
    if (!response.ok) return { status: "unknown", models: [], code: response.status }
    const models = modelNames(await response.json().catch(() => ({})))
    discoveredModelsCache.set(cacheKey, { expiresAt: Date.now() + 2 * 60 * 1000, models })
    return { status: "active", models, code: response.status }
  } catch {
    return { status: "unknown", models: [] }
  } finally {
    clearTimeout(timer)
  }
}

export function apiVaultKeyEntries(): Array<{ provider: string; entry: ApiKeyEntry }> {
  const vault = loadApiVault()
  return Object.entries(vault.providers).flatMap(([provider, entries]) => entries.map((entry) => ({ provider, entry })))
}

export function setAutoRotation(enabled: boolean): void {
  const vault = loadApiVault()
  vault.autoRotate = enabled
  saveApiVault(vault)
}

export function getApiVaultStatus(): Pick<ApiVaultData, "autoRotate" | "fallbackToLocal"> {
  const vault = loadApiVault()
  return { autoRotate: vault.autoRotate, fallbackToLocal: vault.fallbackToLocal }
}

export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4))
}

export function apiVaultKeyPath(): string {
  return apiVaultPath()
}

export function apiVaultHasKeys(providerInput?: string): boolean {
  if (providerInput) return availableApiKeys(providerInput).length > 0
  return apiVaultKeyEntries().length > 0
}

function endpointFor(providerInput: string): string | undefined {
  return contractFor(providerInput)?.modelsEndpoint
}

function authHeadersFor(contract: ProviderContract, key: string): Record<string, string> {
  if (contract.auth === "query") return {}
  if (contract.auth === "x-api-key") return { "x-api-key": key, ...(contract.headers ?? {}) }
  return { Authorization: `Bearer ${key}`, ...(contract.headers ?? {}) }
}

export async function checkKey(providerInput: string, key: string): Promise<{ status: ApiKeyStatus; code?: number }> {
  const provider = normalizeProvider(providerInput)
  const contract = contractFor(providerInput)
  if (!provider || !contract) return { status: "unknown" }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)
  try {
    const headers = authHeadersFor(contract, key)
    const url =
      contract.auth === "query" ? `${contract.modelsEndpoint}?key=${encodeURIComponent(key)}` : contract.modelsEndpoint
    const response = await fetch(url, { headers, signal: controller.signal })
    if (response.ok) return { status: "active", code: response.status }
    if (response.status === 401 || response.status === 403) return { status: "invalid", code: response.status }
    if (response.status === 429) return { status: "rate_limited", code: response.status }
    return { status: "unknown", code: response.status }
  } catch {
    return { status: "unknown" }
  } finally {
    clearTimeout(timer)
  }
}

let cachedVaultStatus: Record<string, ApiKeyEntry> | null = null
let cachedConfiguredStatus: Record<string, ApiKeyEntry> = {}
let lastVaultCacheTime = 0

export function getCachedKeyStatus(key: string): ApiKeyEntry | undefined {
  const now = Date.now()
  if (!cachedVaultStatus || now - lastVaultCacheTime > 5000) {
    const vault = loadApiVault()
    const map: Record<string, ApiKeyEntry> = {}
    for (const entries of Object.values(vault.providers)) {
      for (const entry of entries) {
        map[entry.key] = entry
      }
    }
    cachedVaultStatus = map
    lastVaultCacheTime = now
  }
  return cachedVaultStatus[key] ?? cachedConfiguredStatus[key]
}

let verificationInProgress = false
export async function verifyAllVaultKeys(configured: Record<string, string[]> = {}): Promise<void> {
  if (verificationInProgress) return
  verificationInProgress = true
  try {
    const vault = loadApiVault()
    const vaultKeys = new Set(apiVaultKeyEntries().map(({ entry }) => entry.key))
    const tasks: Promise<void>[] = []
    for (const [prov, entries] of Object.entries(vault.providers)) {
      for (const entry of entries) {
        if (entry.status === "invalid") continue

        // Skip check if recently checked (within 5 minutes)
        if (entry.lastChecked && Date.now() - Date.parse(entry.lastChecked) < 5 * 60 * 1000) continue

        tasks.push(
          (async () => {
            const { status } = await checkKey(prov, entry.key)
            if (status !== "unknown") updateApiKeyStatus(prov, entry.key, status)
          })(),
        )
      }
    }
    for (const [prov, keys] of Object.entries(configured)) {
      for (const key of keys) {
        if (typeof key !== "string" || !key.trim() || vaultKeys.has(key)) continue
        tasks.push(
          (async () => {
            const { status } = await checkKey(prov, key)
            if (status !== "unknown") {
              cachedConfiguredStatus[key] = {
                key,
                label: "config",
                added: new Date().toISOString().slice(0, 10),
                status,
                failures: 0,
                lastChecked: new Date().toISOString(),
              }
            }
          })(),
        )
      }
    }
    await Promise.all(tasks)
  } finally {
    verificationInProgress = false
  }
}

export function resetApiVaultForTests(): void {
  const file = apiVaultPath()
  if (fs.existsSync(file)) fs.unlinkSync(file)
  const usage = apiUsagePath()
  if (fs.existsSync(usage)) fs.unlinkSync(usage)
  cachedVaultStatus = null
  cachedConfiguredStatus = {}
  lastVaultCacheTime = 0
}

export { emptyVault }

export function resolveProviderLabel(provider: string): string {
  return contractFor(provider)?.label ?? provider
}
