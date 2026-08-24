export type ProviderAccessCategory = "verified-recurring" | "account-specific" | "paid-or-unknown" | "custom"

export type NexusApiKeyProvider = {
  id:
    | "groq"
    | "openrouter"
    | "cloudflare-workers-ai"
    | "nvidia-nim"
    | "deepseek"
    | "gemini"
    | "cerebras"
    | "openai"
    | "opencode"
    | "anthropic"
    | "xai"
    | "mistral"
    | "togetherai"
    | "perplexity"
    | "cohere"
    | "fireworks"
    | "moonshotai"
    | "custom"
  name: string
  /** Local product policy only; never an account balance or live billing result. */
  access: ProviderAccessCategory
  /** Lower values are presented first in the existing picker. */
  rank: number
  badge?: string
  detail?: string
}

export const NEXUS_API_KEY_PROVIDERS: NexusApiKeyProvider[] = [
  {
    id: "cloudflare-workers-ai",
    name: "Cloudflare Workers AI",
    access: "verified-recurring",
    rank: 10,
    badge: "Verified daily allocation",
    detail: "10k Neurons/day; account and model conditions apply",
  },
  { id: "nvidia-nim", name: "NVIDIA NIM", access: "account-specific", rank: 20, badge: "Account/model access" },
  { id: "groq", name: "Groq", access: "paid-or-unknown", rank: 30 },
  { id: "openrouter", name: "OpenRouter", access: "paid-or-unknown", rank: 31 },
  { id: "deepseek", name: "DeepSeek", access: "paid-or-unknown", rank: 32 },
  { id: "gemini", name: "Gemini", access: "paid-or-unknown", rank: 33 },
  { id: "cerebras", name: "Cerebras", access: "paid-or-unknown", rank: 34 },
  { id: "openai", name: "OpenAI", access: "paid-or-unknown", rank: 35 },
  { id: "opencode", name: "OpenCode", access: "paid-or-unknown", rank: 36 },
  { id: "anthropic", name: "Anthropic", access: "paid-or-unknown", rank: 37 },
  { id: "xai", name: "xAI (Grok)", access: "paid-or-unknown", rank: 38 },
  { id: "mistral", name: "Mistral AI", access: "paid-or-unknown", rank: 39 },
  { id: "togetherai", name: "Together AI", access: "paid-or-unknown", rank: 40 },
  { id: "perplexity", name: "Perplexity", access: "paid-or-unknown", rank: 41 },
  { id: "cohere", name: "Cohere", access: "paid-or-unknown", rank: 42 },
  { id: "fireworks", name: "Fireworks AI", access: "paid-or-unknown", rank: 43 },
  { id: "moonshotai", name: "Moonshot AI (Kimi)", access: "paid-or-unknown", rank: 44 },
  { id: "custom", name: "Custom OpenAI-compatible API", access: "custom", rank: 90, badge: "Custom" },
]

export function rankedApiKeyProviders() {
  return [...NEXUS_API_KEY_PROVIDERS].sort(
    (left, right) => left.rank - right.rank || left.name.localeCompare(right.name),
  )
}
