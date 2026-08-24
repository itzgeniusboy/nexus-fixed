import open from "open"

const SENSITIVE_QUERY_KEYS = /^(access_?token|api_?key|code|credential|key|password|refresh_?token|secret|session|token)$/i

export type BrowserHandoffTarget = {
  launchUrl: string
  origin: string
  hasSensitiveQuery: boolean
}

export type BrowserHandoffLauncher = (url: string) => Promise<void>

function isTermuxEnvironment() {
  return process.env.TERMUX_VERSION !== undefined || process.env.PREFIX?.includes("/com.termux/files/usr") === true
}

export function parseBrowserHandoffTarget(input: string): BrowserHandoffTarget {
  const parsed = new URL(input)
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("Browser handoff only accepts an explicit http:// or https:// URL")
  const hasSensitiveQuery = [...parsed.searchParams.keys()].some((key) => SENSITIVE_QUERY_KEYS.test(key))
  return { launchUrl: parsed.toString(), origin: parsed.origin, hasSensitiveQuery }
}

export async function openLocalBrowser(url: string, options: { termuxOpener?: string } = {}) {
  if (isTermuxEnvironment()) {
    const child = Bun.spawn([options.termuxOpener ?? "termux-open-url", url], { stdout: "ignore", stderr: "pipe" })
    const exitCode = await child.exited
    if (exitCode !== 0) {
      const stderr = await new Response(child.stderr).text()
      throw new Error(`Unable to open the Android browser with termux-open-url${stderr.trim() ? `: ${stderr.trim()}` : ""}`)
    }
    return
  }
  await open(url, { wait: false })
}

export * as BrowserHandoff from "./browser-handoff"
