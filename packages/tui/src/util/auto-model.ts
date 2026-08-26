import type { Model, Provider } from "@nexus-ai/sdk/v2"

export type AutoKeyHealth = {
  provider: string
  keys: Array<{ status: string }>
}

export type AutoModelInput = {
  task: string
  hasImage?: boolean
  providers: Provider[]
  connected?: Array<string>
  keyHealth?: Array<AutoKeyHealth>
  quarantined?: ReadonlyArray<string>
}

export type AutoModelChoice = {
  providerID: string
  modelID: string
  reason: string
}

export function routeKey(providerID: string, modelID: string) {
  return `${providerID}/${modelID}`
}

/**
 * Local-only heuristic; callers must not log or retain its source text.
 * Plain chat resolves to the cheapest capable model so conversational turns stay
 * fast and free-tier friendly, while tool/vision/reasoning tasks prefer model
 * strength over cost.
 *
 * Catalog visibility never implies a usable route: when credential state is
 * supplied, only configured providers with at least one usable key are eligible,
 * quarantined routes are skipped, and deprecated models are excluded.
 */
export function resolveAutoModel(input: AutoModelInput): AutoModelChoice | undefined {
  const requirements = classify(input.task, input.hasImage === true)
  const usable = input.providers
    .flatMap((provider) => Object.values(provider.models).map((model) => ({ provider, model })))
    .filter(
      ({ provider, model }) =>
        model.status !== "deprecated" &&
        supports(model, requirements) &&
        !input.quarantined?.includes(routeKey(provider.id, model.id)) &&
        configured(provider.id, input),
    )
  if (usable.length === 0) return undefined
  const pick =
    requirements.tools || requirements.vision || requirements.longContext || requirements.reasoning
      ? [...usable].sort(byStrength)[0]
      : [...usable].sort(byCost)[0]
  return (
    pick && {
      providerID: pick.provider.id,
      modelID: pick.model.id,
      reason: requirements.vision
        ? "vision"
        : requirements.tools
          ? "tools"
          : requirements.reasoning
            ? "reasoning"
            : requirements.longContext
              ? "context"
              : "chat",
    }
  )
}

function classify(task: string, hasImage: boolean) {
  const normalized = task.trim().toLowerCase()
  return {
    tools:
      /\b(?:code|implement|build|fix|refactor|terminal|bash|shell|git|test|debug|edit|file|deploy)\b/.test(
        normalized,
      ),
    vision: hasImage || /\b(?:image|screenshot|photo|picture|visual|ocr)\b/.test(normalized),
    longContext:
      /\b(?:repository|repo|codebase|multi[- ]file|multiple files|whole project|large document|long document)\b/.test(
        normalized,
      ),
    reasoning: /\b(?:reason(?:ing)?|analy[sz]e|diagnose|trade[- ]?off|architecture|plan)\b/.test(normalized),
  }
}

type Requirements = ReturnType<typeof classify>

function supports(model: Model, requirements: Requirements) {
  if (requirements.tools && !model.capabilities.toolcall) return false
  if (requirements.vision && !(model.capabilities.attachment || model.capabilities.input.image)) return false
  if (requirements.longContext && model.limit.context < 32_000) return false
  if (requirements.reasoning && !model.capabilities.reasoning) return false
  return true
}

function byCost(left: { model: Model }, right: { model: Model }) {
  return (
    (left.model.cost?.input ?? 0) - (right.model.cost?.input ?? 0) ||
    left.model.id.localeCompare(right.model.id)
  )
}

function byStrength(left: { model: Model }, right: { model: Model }) {
  return (
    strength(left.model) - strength(right.model) ||
    (left.model.cost?.input ?? 0) - (right.model.cost?.input ?? 0)
  )
}

function strength(model: Model) {
  return (
    (model.capabilities.reasoning ? 0 : 4) +
    (model.capabilities.toolcall ? 0 : 2) +
    Math.max(0, 8 - Math.log10(Math.max(model.limit.context, 1000)))
  )
}

// With no credential state at all the legacy behavior applies so pure callers
// keep working; production always passes server connection state.
function configured(providerID: string, input: AutoModelInput) {
  if (input.connected === undefined && input.keyHealth === undefined) return true
  if (input.connected && !input.connected.includes(providerID)) return false
  const keys = input.keyHealth?.find((item) => item.provider === providerID)?.keys ?? []
  // Multiple keys per provider: any key not locally known-bad keeps routes eligible.
  if (keys.length > 0) return keys.some((key) => key.status !== "invalid" && key.status !== "suspended")
  return true
}
