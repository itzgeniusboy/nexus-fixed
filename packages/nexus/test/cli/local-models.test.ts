import { describe, expect, test } from "bun:test"
import type { DeviceResourceConfig } from "@nexus-ai/core/device"
import {
  formatLocalModelRecommendations,
  localModelHardwareProfile,
  recommendedLocalModels,
} from "../../src/cli/cmd/local-models"

function device(overrides: Partial<DeviceResourceConfig> = {}): DeviceResourceConfig {
  return {
    tier: "medium",
    totalRamGB: 8,
    cpuCores: 8,
    isTermux: false,
    isARM64: false,
    maxConcurrency: 2,
    maxConcurrentTools: 2,
    maxToolOutputBytes: 50_000,
    maxToolOutputLines: 2_000,
    disableBackgroundAgents: false,
    disableWatcher: false,
    compactContext: true,
    ...overrides,
  }
}

describe("local model recommendations", () => {
  test("reports only observed hardware facts and never invents a GPU", () => {
    expect(localModelHardwareProfile(device({ isTermux: true, isARM64: true }))).toMatchObject({
      platform: "Termux",
      architecture: "ARM64",
      gpu: "not detected",
    })
  })

  test("filters catalog conservatively by RAM and keeps output no-download", () => {
    expect(recommendedLocalModels(device({ totalRamGB: 4 })).every((model) => model.minimumRamGB <= 2.8)).toBe(true)
    const output = formatLocalModelRecommendations(device({ totalRamGB: 4, isTermux: true, isARM64: true })).join("\n")
    expect(output).toContain("No download was started.")
    expect(output).toContain("GPU/VRAM: not detected")
    expect(output).toContain("Termux:")
  })
})
