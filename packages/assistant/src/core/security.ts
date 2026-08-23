import { EOL } from "os"
import { Style } from "./style"
import type { HitlRequest, PluginContext } from "./types"

const SENSITIVE_URL_PATTERNS = [
  "login",
  "signin",
  "sign-in",
  "auth",
  "2fa",
  "otp",
  "verify",
  "challenge",
  "cpsess",
  "wp-login",
]

const SENSITIVE_ACTIONS = [
  "delete",
  "remove",
  "drop",
  "destroy",
  "payment",
  "purchase",
  "buy",
  "password",
  "revoke",
]

export function isSensitiveUrl(url: string): boolean {
  const lower = url.toLowerCase()
  return SENSITIVE_URL_PATTERNS.some((p) => lower.includes(p))
}

export function isSensitiveAction(text: string): boolean {
  const lower = text.toLowerCase()
  return SENSITIVE_ACTIONS.some((p) => lower.includes(p))
}

export const SECURITY_RULES = [
  "NO password storage — API tokens/SSH keys only",
  "NO OTP interception — never read SMS, email or authenticator codes",
  "NO CAPTCHA bypass — always human-in-the-loop",
  "NO auto-login — never fill login forms automatically",
  "Session reuse — only the user's own browser profile on their own machine",
  "Explicit consent — dangerous actions require yes/no confirmation",
  "Audit log — record what was done, never credentials",
]

export async function confirmViaStdin(request: HitlRequest): Promise<boolean> {
  if (process.env.NEXUS_ASSUME_YES === "1") return true
  if (process.env.NEXUS_ASSUME_YES === "0") return false
  const icon = request.danger ? `${Style.TEXT_WARNING}⚠️` : `${Style.TEXT_INFO}🔐`
  process.stderr.write(`${EOL}${icon} ${request.title}${Style.TEXT_NORMAL}${EOL}`)
  if (request.detail) process.stderr.write(`${Style.TEXT_DIM}${request.detail}${Style.TEXT_NORMAL}${EOL}`)
  if (request.danger) {
    process.stderr.write(`${Style.TEXT_DIM}NEXUS never asks for passwords or OTPs.${Style.TEXT_NORMAL}${EOL}`)
  }
  process.stderr.write(`${Style.TEXT_HIGHLIGHT_BOLD}Proceed? [y/N] ${Style.TEXT_NORMAL}`)
  const answer = await readLine()
  return answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes"
}

function readLine(): Promise<string> {
  return new Promise((resolve) => {
    let input = ""
    const stdin = process.stdin
    stdin.setEncoding("utf8")
    stdin.resume()
    const onData = (chunk: string) => {
      input += chunk
      if (input.includes(EOL)) {
        stdin.pause()
        stdin.removeListener("data", onData)
        resolve(input.split(EOL)[0] ?? "")
      }
    }
    stdin.on("data", onData)
  })
}

export function makeContext(base: Omit<PluginContext, "confirm">): PluginContext {
  return {
    ...base,
    confirm: (request) => confirmViaStdin(request),
  }
}

export function audit(action: string, detail: Record<string, unknown>) {
  const safe = JSON.stringify({ ts: Date.now(), action, ...detail })
  process.env.NEXUS_AUDIT && process.stderr.write(`${Style.TEXT_DIM}[audit] ${safe}${Style.TEXT_NORMAL}${EOL}`)
}

export * as Security from "./security"
