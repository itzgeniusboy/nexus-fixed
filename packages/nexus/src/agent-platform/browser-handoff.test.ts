import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { openLocalBrowser, parseBrowserHandoffTarget } from "./browser-handoff"

describe("BrowserHandoff", () => {
  test("accepts HTTP(S) URLs while exposing only an audit-safe origin", () => {
    const target = parseBrowserHandoffTarget("https://console.example.test/project?token=private-value#fragment")
    expect(target.origin).toBe("https://console.example.test")
    expect(target.hasSensitiveQuery).toBe(true)
    expect(target.launchUrl).toContain("private-value")
  })

  test("rejects non-web URL schemes", () => {
    expect(() => parseBrowserHandoffTarget("file:///private/data")).toThrow("http:// or https://")
    expect(() => parseBrowserHandoffTarget("javascript:alert(1)")).toThrow("http:// or https://")
  })

  test("uses the local Termux opener without exposing its URL to stored handoff data", async () => {
    const root = mkdtempSync(join(tmpdir(), "nexus-browser-handoff-"))
    const marker = join(root, "opened-url.txt")
    const opener = join(root, "termux-open-url")
    writeFileSync(opener, `#!/bin/sh\nprintf '%s' "$1" > "${marker}"\n`)
    chmodSync(opener, 0o755)
    const original = { termux: process.env.TERMUX_VERSION, path: process.env.PATH }
    try {
      process.env.TERMUX_VERSION = "1"
      process.env.PATH = `${root}:${original.path ?? ""}`
      await openLocalBrowser("https://portal.example.test/login?token=private-value", { termuxOpener: opener })
      expect(readFileSync(marker, "utf8")).toContain("private-value")
    } finally {
      if (original.termux === undefined) delete process.env.TERMUX_VERSION
      else process.env.TERMUX_VERSION = original.termux
      if (original.path === undefined) delete process.env.PATH
      else process.env.PATH = original.path
      rmSync(root, { recursive: true, force: true })
    }
  })
})
