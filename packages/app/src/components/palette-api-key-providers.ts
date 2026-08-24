export type NexusApiKeyProvider = {
  id:
    | "groq"
    | "openrouter"
    | "cloudflare-workers-ai"
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
}

export const NEXUS_API_KEY_PROVIDERS: NexusApiKeyProvider[] = [
  { id: "groq", name: "Groq" },
  { id: "openrouter", name: "OpenRouter" },
  { id: "cloudflare-workers-ai", name: "Cloudflare Workers AI" },
  { id: "deepseek", name: "DeepSeek" },
  { id: "gemini", name: "Gemini" },
  { id: "cerebras", name: "Cerebras" },
  { id: "openai", name: "OpenAI" },
  { id: "opencode", name: "OpenCode" },
  { id: "anthropic", name: "Anthropic" },
  { id: "xai", name: "xAI (Grok)" },
  { id: "mistral", name: "Mistral AI" },
  { id: "togetherai", name: "Together AI" },
  { id: "perplexity", name: "Perplexity" },
  { id: "cohere", name: "Cohere" },
  { id: "fireworks", name: "Fireworks AI" },
  { id: "moonshotai", name: "Moonshot AI (Kimi)" },
  { id: "custom", name: "Custom OpenAI-compatible API" },
]
