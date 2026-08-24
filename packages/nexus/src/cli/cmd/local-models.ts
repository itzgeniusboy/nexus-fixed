import type { DeviceResourceConfig } from "@nexus-ai/core/device"

export type LocalModelCatalogEntry = {
  id: string
  label: string
  quantization: string
  downloadGB: number
  storageGB: number
  minimumRamGB: number
  contextTokens: number
  likelySpeed: "compact" | "moderate" | "heavy"
}

export type LocalModelHardwareProfile = {
  ramGB: number
  cpuCores: number
  tier: DeviceResourceConfig["tier"]
  platform: "Termux" | "PC"
  architecture: string
  gpu: "not detected"
}

export const LOCAL_MODEL_CATALOG: readonly LocalModelCatalogEntry[] = [
  {
    id: "qwen2.5-coder:3b-instruct-q4",
    label: "Qwen 2.5 Coder 3B",
    quantization: "Q4",
    downloadGB: 2.1,
    storageGB: 2.5,
    minimumRamGB: 4,
    contextTokens: 32_000,
    likelySpeed: "compact",
  },
  {
    id: "llama3.2:3b-instruct-q4",
    label: "Llama 3.2 3B",
    quantization: "Q4",
    downloadGB: 2,
    storageGB: 2.4,
    minimumRamGB: 4,
    contextTokens: 128_000,
    likelySpeed: "compact",
  },
  {
    id: "qwen2.5-coder:7b-instruct-q4",
    label: "Qwen 2.5 Coder 7B",
    quantization: "Q4",
    downloadGB: 4.7,
    storageGB: 5.4,
    minimumRamGB: 8,
    contextTokens: 32_000,
    likelySpeed: "moderate",
  },
  {
    id: "llama3.1:8b-instruct-q4",
    label: "Llama 3.1 8B",
    quantization: "Q4",
    downloadGB: 4.9,
    storageGB: 5.6,
    minimumRamGB: 8,
    contextTokens: 128_000,
    likelySpeed: "moderate",
  },
  {
    id: "qwen2.5-coder:14b-instruct-q4",
    label: "Qwen 2.5 Coder 14B",
    quantization: "Q4",
    downloadGB: 9.1,
    storageGB: 10.2,
    minimumRamGB: 16,
    contextTokens: 32_000,
    likelySpeed: "heavy",
  },
]

export function localModelHardwareProfile(config: DeviceResourceConfig): LocalModelHardwareProfile {
  return {
    ramGB: Number(config.totalRamGB.toFixed(1)),
    cpuCores: config.cpuCores,
    tier: config.tier,
    platform: config.isTermux ? "Termux" : "PC",
    architecture: config.isARM64 ? "ARM64" : "x64/other",
    gpu: "not detected",
  }
}

export function recommendedLocalModels(config: DeviceResourceConfig) {
  return LOCAL_MODEL_CATALOG.filter((model) => model.minimumRamGB <= config.totalRamGB * 0.7)
}

export function formatLocalModelRecommendations(config: DeviceResourceConfig) {
  const profile = localModelHardwareProfile(config)
  const recommendations = recommendedLocalModels(config)
  const lines = [
    `Local device: ${profile.platform} ${profile.architecture}; ${profile.ramGB.toFixed(1)}GB RAM; ${profile.cpuCores} CPU cores; ${profile.tier} tier`,
    "GPU/VRAM: not detected by NEXUS (no GPU capability is assumed)",
    "Catalog estimates are approximate; download, storage, speed, and context capacity are not guarantees.",
  ]
  if (profile.platform === "Termux") {
    lines.push(
      "Termux: keep battery, thermal, storage, and metered-network safeguards enabled before any manual local-model setup.",
    )
  }
  if (recommendations.length === 0) {
    lines.push("No catalog entry is conservatively recommended for detected RAM. No download was started.")
    return lines
  }
  lines.push("Recommended catalog (informational only; no download was started):")
  for (const model of recommendations) {
    lines.push(
      `- ${model.label} (${model.id}) — ${model.quantization}; ~${model.downloadGB}GB download / ~${model.storageGB}GB storage; >=${model.minimumRamGB}GB RAM; ~${model.contextTokens.toLocaleString()} context; likely ${model.likelySpeed}`,
    )
  }
  return lines
}
