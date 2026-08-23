/**
 * Single source of truth for every API vault provider.
 *
 * Adding a provider = one entry here. Validation (`checkKey`), model discovery,
 * wizard labels, offline transport fallbacks, and env-key mapping all read from
 * this registry, so a listed provider can never lack its runtime contract.
 */

export type AuthStyle = "bearer" | "x-api-key" | "query"

export interface ProviderContract {
  /** Canonical vault/provider id used across CLI, vault, and routing. */
  id: string
  /** Human-readable label shown by the wizard and TUI. */
  label: string
  /** Convenience aliases accepted by `nexus api add` etc. */
  aliases?: string[]
  /** GET endpoint used for key validation and model discovery. */
  modelsEndpoint: string
  /** How the key is presented to the provider API. */
  auth: AuthStyle
  /** Extra static headers required alongside auth. */
  headers?: Record<string, string>
  /** OpenAI-compatible chat base URL used for request transport. */
  baseURL: string
  /** Bundled AI SDK package implementing request transport. */
  npm: string
  /** Well-known environment variable names checked for this provider. */
  env: string[]
}

export const PROVIDER_CONTRACTS: Record<string, ProviderContract> = {
  groq: {
    id: "groq",
    label: "Groq",
    modelsEndpoint: "https://api.groq.com/openai/v1/models",
    auth: "bearer",
    baseURL: "https://api.groq.com/openai/v1",
    npm: "@ai-sdk/groq",
    env: ["GROQ_API_KEY"],
  },
  openrouter: {
    id: "openrouter",
    label: "OpenRouter",
    aliases: ["or"],
    modelsEndpoint: "https://openrouter.ai/api/v1/models",
    auth: "bearer",
    baseURL: "https://openrouter.ai/api/v1",
    npm: "@openrouter/ai-sdk-provider",
    env: ["OPENROUTER_API_KEY"],
  },
  deepseek: {
    id: "deepseek",
    label: "DeepSeek",
    modelsEndpoint: "https://api.deepseek.com/models",
    auth: "bearer",
    baseURL: "https://api.deepseek.com/v1",
    npm: "@ai-sdk/openai-compatible",
    env: ["DEEPSEEK_API_KEY"],
  },
  gemini: {
    id: "gemini",
    label: "Google Gemini",
    aliases: ["google"],
    modelsEndpoint: "https://generativelanguage.googleapis.com/v1beta/models",
    auth: "query",
    baseURL: "https://generativelanguage.googleapis.com/v1beta",
    npm: "@ai-sdk/google",
    env: ["GEMINI_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"],
  },
  cerebras: {
    id: "cerebras",
    label: "Cerebras",
    modelsEndpoint: "https://api.cerebras.ai/v1/models",
    auth: "bearer",
    baseURL: "https://api.cerebras.ai/v1",
    npm: "@ai-sdk/cerebras",
    env: ["CEREBRAS_API_KEY"],
  },
  openai: {
    id: "openai",
    label: "OpenAI",
    modelsEndpoint: "https://api.openai.com/v1/models",
    auth: "bearer",
    baseURL: "https://api.openai.com/v1",
    npm: "@ai-sdk/openai",
    env: ["OPENAI_API_KEY"],
  },
  opencode: {
    id: "opencode",
    label: "OpenCode Gateway",
    modelsEndpoint: "https://opencode.ai/zen/v1/models",
    auth: "bearer",
    baseURL: "https://opencode.ai/zen/v1",
    npm: "@ai-sdk/openai-compatible",
    env: [],
  },
  anthropic: {
    id: "anthropic",
    label: "Anthropic (Claude)",
    aliases: ["claude"],
    modelsEndpoint: "https://api.anthropic.com/v1/models",
    auth: "x-api-key",
    headers: { "anthropic-version": "2023-06-01" },
    baseURL: "https://api.anthropic.com/v1",
    npm: "@ai-sdk/anthropic",
    env: ["ANTHROPIC_API_KEY"],
  },
  xai: {
    id: "xai",
    label: "xAI (Grok)",
    aliases: ["grok"],
    modelsEndpoint: "https://api.x.ai/v1/models",
    auth: "bearer",
    baseURL: "https://api.x.ai/v1",
    npm: "@ai-sdk/xai",
    env: ["XAI_API_KEY"],
  },
  mistral: {
    id: "mistral",
    label: "Mistral AI",
    modelsEndpoint: "https://api.mistral.ai/v1/models",
    auth: "bearer",
    baseURL: "https://api.mistral.ai/v1",
    npm: "@ai-sdk/mistral",
    env: ["MISTRAL_API_KEY"],
  },
  togetherai: {
    id: "togetherai",
    label: "Together AI",
    aliases: ["together"],
    modelsEndpoint: "https://api.together.xyz/v1/models",
    auth: "bearer",
    baseURL: "https://api.together.xyz/v1",
    npm: "@ai-sdk/togetherai",
    env: ["TOGETHER_API_KEY"],
  },
  perplexity: {
    id: "perplexity",
    label: "Perplexity",
    aliases: ["pplx"],
    modelsEndpoint: "https://api.perplexity.ai/models",
    auth: "bearer",
    baseURL: "https://api.perplexity.ai",
    npm: "@ai-sdk/perplexity",
    env: ["PERPLEXITY_API_KEY"],
  },
  cohere: {
    id: "cohere",
    label: "Cohere",
    modelsEndpoint: "https://api.cohere.com/v1/models",
    auth: "bearer",
    baseURL: "https://api.cohere.com/compatibility/v1",
    npm: "@ai-sdk/cohere",
    env: ["COHERE_API_KEY"],
  },
  fireworks: {
    id: "fireworks",
    label: "Fireworks AI",
    modelsEndpoint: "https://api.fireworks.ai/inference/v1/models",
    auth: "bearer",
    baseURL: "https://api.fireworks.ai/inference/v1",
    npm: "@ai-sdk/openai-compatible",
    env: ["FIREWORKS_API_KEY"],
  },
  moonshotai: {
    id: "moonshotai",
    label: "Moonshot AI (Kimi)",
    aliases: ["kimi", "moonshot"],
    modelsEndpoint: "https://api.moonshot.cn/v1/models",
    auth: "bearer",
    baseURL: "https://api.moonshot.cn/v1",
    npm: "@ai-sdk/openai-compatible",
    env: ["MOONSHOT_API_KEY"],
  },
}

export const REGISTRY_PROVIDER_IDS = Object.keys(PROVIDER_CONTRACTS)

/** Resolve an id or alias to its canonical contract. */
export function contractFor(input: string): ProviderContract | undefined {
  const raw = input.trim().toLowerCase().replace(/[\s_]+/g, "-")
  const direct = PROVIDER_CONTRACTS[raw]
  if (direct) return direct
  return Object.values(PROVIDER_CONTRACTS).find((contract) => contract.aliases?.includes(raw))
}
