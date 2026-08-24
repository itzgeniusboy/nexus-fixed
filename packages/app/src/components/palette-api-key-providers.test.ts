import { describe, expect, test } from "bun:test"
import { NEXUS_API_KEY_PROVIDERS, rankedApiKeyProviders } from "./palette-api-key-providers"

describe("NEXUS API provider picker policy", () => {
  test("ranks the source-backed recurring allocation before account-specific and unknown access", () => {
    const ranked = rankedApiKeyProviders()
    expect(ranked.map((provider) => provider.id).slice(0, 2)).toEqual(["cloudflare-workers-ai", "nvidia-nim"])
    expect(ranked.find((provider) => provider.id === "cloudflare-workers-ai")).toMatchObject({
      access: "verified-recurring",
      badge: "Verified daily allocation",
    })
    expect(ranked.find((provider) => provider.id === "nvidia-nim")).toMatchObject({
      access: "account-specific",
      badge: "Account/model access",
    })
  })

  test("keeps custom onboarding available while omitting fabricated free-quota badges", () => {
    expect(NEXUS_API_KEY_PROVIDERS.find((provider) => provider.id === "custom")).toMatchObject({ access: "custom" })
    expect(
      NEXUS_API_KEY_PROVIDERS.filter((provider) => provider.access === "paid-or-unknown").every(
        (provider) => !provider.badge,
      ),
    ).toBe(true)
  })
})
