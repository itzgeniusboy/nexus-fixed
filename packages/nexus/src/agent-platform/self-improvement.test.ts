import { classifyAdaptiveIntent } from "./adaptive-intent"
import { markProposalVerified, proposalSummary, proposeSelfImprovement } from "./self-improvement"

const noBrowser = {
  platform: "linux",
  architecture: "x64",
  termux: false,
  git: true,
  github: false,
  browserHandoff: false,
  browserHttpInspection: false,
  browserAutomation: false,
  webRuntime: true,
  android: false,
  androidDevice: false,
  apkBuild: false,
  packageManagers: ["bun"],
} as const

describe("controlled self-improvement", () => {
  test("creates a reviewable proposal for missing capabilities", () => {
    const intent = classifyAdaptiveIntent("Test the website login flow", noBrowser)
    const proposal = proposeSelfImprovement(intent)
    expect(proposal?.status).toBe("proposed")
    expect(proposal?.requiresApproval).toBe(true)
    expect(proposal?.activatesAutomatically).toBe(false)
    expect(proposal?.verification).toEqual(expect.arrayContaining([expect.stringMatching(/lint/i)]))
    expect(proposalSummary(proposal!)).toMatch(/approval required=true/i)
  })

  test("does not propose upgrades when required capabilities exist", () => {
    const intent = classifyAdaptiveIntent("Fix a CLI bug", noBrowser)
    expect(proposeSelfImprovement(intent)).toBeUndefined()
  })

  test("cannot silently activate an unverified proposal", () => {
    const intent = classifyAdaptiveIntent("Test website buttons", noBrowser)
    const proposal = proposeSelfImprovement(intent)!
    expect(markProposalVerified(proposal, false).status).toBe("blocked")
    expect(markProposalVerified(proposal, true).status).toBe("verified")
    expect(markProposalVerified(proposal, true).activatesAutomatically).toBe(false)
  })
})
