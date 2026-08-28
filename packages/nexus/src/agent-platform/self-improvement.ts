import { createHash } from "node:crypto"
import type { AdaptiveIntent } from "./adaptive-intent"

export type SelfImprovementProposal = {
  id: string
  title: string
  reason: string
  scope: string[]
  verification: string[]
  status: "proposed" | "verified" | "blocked"
  requiresApproval: true
  activatesAutomatically: false
}

export function proposeSelfImprovement(intent: AdaptiveIntent): SelfImprovementProposal | undefined {
  if (intent.capabilityGaps.length === 0) return undefined
  const title = `Add safe adapter: ${intent.capabilityGaps.join(", ")}`
  const id = createHash("sha256").update(`${intent.objective}\0${title}`).digest("hex").slice(0, 20)
  return {
    id,
    title,
    reason: `The current task requires ${intent.capabilityGaps.join(", ")}, which is not available on this device.`,
    scope: [
      "Add a typed adapter behind the existing permission boundary.",
      "Add deterministic focused tests and capability detection.",
      "Keep unsupported behavior blocked until verification passes.",
    ],
    verification: [
      "Run targeted formatting, lint, and regression tests.",
      "Verify no secrets or arbitrary shell commands enter the adapter.",
      "Require explicit approval before external mutations or activation.",
    ],
    status: "proposed",
    requiresApproval: true,
    activatesAutomatically: false,
  }
}

export function markProposalVerified(proposal: SelfImprovementProposal, verified: boolean): SelfImprovementProposal {
  return { ...proposal, status: verified ? "verified" : "blocked" }
}

export function proposalSummary(proposal: SelfImprovementProposal): string {
  return `${proposal.status}: ${proposal.title}. Approval required=${proposal.requiresApproval}; automatic activation=${proposal.activatesAutomatically}.`
}

export * as SelfImprovement from "./self-improvement"
