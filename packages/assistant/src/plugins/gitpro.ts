import path from "path"
import { Style, Icon } from "../core/style"
import { isSensitiveAction } from "../core/security"
import type { NexusPlugin, PluginContext } from "../core/types"

interface ReviewFinding {
  file: string
  line: number
  severity: "critical" | "warning" | "info"
  message: string
}

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/(?:sk|pk)_[a-zA-Z0-9]{20,}/, "Possible Stripe/API key"],
  [/\bsk-[a-zA-Z0-9-]{20,}/, "Possible API key (dash format)"],
  [/sk-ant-[a-zA-Z0-9-]{20,}/, "Anthropic API key"],
  [/AKIA[0-9A-Z]{16}/, "AWS access key id"],
  [/ghp_[a-zA-Z0-9]{36}/, "GitHub personal access token"],
  [/(?:jwt|secret|password|token)\s*[:=]\s*["'][^"']{8,}["']/i, "Hardcoded secret"],
  [/-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/, "Private key material"],
]

async function diff(cwd: string, staged: boolean): Promise<string> {
  const args = ["git", "diff", staged ? "--cached" : "HEAD"]
  const proc = Bun.spawn(args, { cwd, stdout: "pipe", stderr: "ignore" })
  const [exit] = await Promise.all([proc.exited])
  return exit !== 0 ? "" : await new Response(proc.stdout).text()
}

function review(diffText: string): ReviewFinding[] {
  const findings: ReviewFinding[] = []
  let currentFile = ""
  let currentLine = 0

  for (const line of diffText.split("\n")) {
    if (line.startsWith("+++ b/")) currentFile = line.slice(6)
    else if (line.startsWith("diff --git")) currentLine = 0
    if (line.startsWith("@@")) {
      const match = line.match(/\+(\d+)/)
      currentLine = match ? parseInt(match[1]) : 0
      continue
    }
    if (!line.startsWith("+") || line.startsWith("+++")) continue
    for (const [regex, message] of SECRET_PATTERNS) {
      if (regex.test(line)) {
        findings.push({ file: currentFile, line: currentLine, severity: "critical", message })
        break
      }
    }
    if (/console\.log\(|debugger\b/.test(line)) {
      findings.push({ file: currentFile, line: currentLine, severity: "warning", message: "Debug statement left in code" })
    }
    if (/\bfetch\(/.test(line) && !/try|catch/.test(line)) {
      findings.push({ file: currentFile, line: currentLine, severity: "info", message: "fetch() without visible error handling nearby" })
    }
    currentLine++
  }

  return findings
}

async function untrackedFiles(cwd: string): Promise<string[]> {
  const proc = Bun.spawn(["git", "ls-files", "--others", "--exclude-standard"], { cwd, stdout: "pipe", stderr: "ignore" })
  const [exit] = await Promise.all([proc.exited])
  if (exit !== 0) return []
  return (await new Response(proc.stdout).text()).split("\n").filter(Boolean)
}

function scanPlainFile(file: string, content: string): ReviewFinding[] {
  const findings: ReviewFinding[] = []
  for (const [index, text] of content.split("\n").entries()) {
    for (const [regex, message] of SECRET_PATTERNS) {
      if (regex.test(text)) {
        findings.push({ file, line: index + 1, severity: "critical", message })
        break
      }
    }
    if (/console\.log\(|debugger\b/.test(text)) {
      findings.push({ file, line: index + 1, severity: "warning", message: "Debug statement left in code" })
    }
  }
  return findings
}

async function commit(ctx: PluginContext): Promise<number | void> {
  const cwd = path.resolve(ctx.cwd, ctx.args.find((a) => !a.startsWith("-") && !ctx.flags.message) ?? ".")
  const gitDir = Bun.spawn(["git", "rev-parse", "--is-inside-work-tree"], { cwd, stdout: "pipe", stderr: "ignore" })
  if ((await gitDir.exited) !== 0) {
    ctx.err("Not inside a git repository")
    return 1
  }

  const staged = await diff(cwd, true)
  const unstaged = staged.length === 0 ? await diff(cwd, false) : staged
  const diffText = staged || unstaged

  if (!diffText.trim()) {
    ctx.out(`${Icon.warn} No changes to review`)
    return 0
  }

  ctx.out(`${Icon.brain} NEXUS Smart Commit — reviewing ${diffText.split("\n").length} diff lines`)
  const findings = review(diffText)

  if (findings.length > 0) {
    for (const finding of findings) {
      const color =
        finding.severity === "critical"
          ? Style.TEXT_DANGER_BOLD
          : finding.severity === "warning"
            ? Style.TEXT_WARNING_BOLD
            : Style.TEXT_DIM
      ctx.out(`  ${Icon.warn} ${color}${finding.file}:${finding.line}${Style.TEXT_NORMAL} ${finding.message}`)
    }

    const hasCritical = findings.some((f) => f.severity === "critical")
    if (hasCritical && !ctx.flags.noVerify) {
      const proceed = await ctx.confirm({
        title: "Critical findings detected — commit anyway?",
        detail: "Secrets in commits are extremely hard to revoke safely",
        danger: true,
      })
      if (!proceed) {
        ctx.out("Commit cancelled — fix the issues and retry")
        return 1
      }
    }
  }

  const message = typeof ctx.flags.message === "string"
    ? ctx.flags.message
    : await suggestMessage(diffText, ctx)

  if (!message) {
    ctx.err("Could not generate a commit message — pass one with -m")
    return 1
  }

  if (typeof ctx.flags.dryRun === "boolean" && ctx.flags.dryRun) {
    ctx.out(`${Icon.info} Dry run — suggested message:\n  ${Style.TEXT_HIGHLIGHT}${message}${Style.TEXT_NORMAL}`)
    return 0
  }

  if (staged.length === 0) {
    const add = Bun.spawn(["git", "add", "-A"], { cwd, stdout: "inherit", stderr: "inherit" })
    await add.exited
  }

  const proc = Bun.spawn(["git", "commit", "-m", message], { cwd, stdout: "pipe", stderr: "pipe" })
  const exit = await proc.exited
  if (exit !== 0) {
    ctx.err(`git commit failed: ${await new Response(proc.stderr).text()}`)
    return 1
  }
  ctx.out(`${Icon.success} Committed: ${Style.TEXT_SUCCESS_BOLD}${message.split("\n")[0]}${Style.TEXT_NORMAL}`)
}

async function suggestMessage(diffText: string, ctx: PluginContext): Promise<string | undefined> {
  const summary = diffText.slice(0, 6000)

  if (ctx.llm) {
    const result = await ctx.llm.generate(
      `Write a conventional-commit message (type(scope): summary + body bullets) for this diff. Reply with the message only.\n\n${summary}`,
    )
    return result.trim()
  }

  const files = [...new Set([...diffText.matchAll(/^diff --git a\/(\S+)/gm)].map((m) => m[1]))]
  const additions = (diffText.match(/^\+(?!\+\+)/gm) ?? []).length
  const deletions = (diffText.match(/^-(?!--)/gm) ?? []).length
  const scope = files[0]?.split("/")[0]?.replace(/\..+$/, "") ?? "code"

  if (isSensitiveAction(diffText.slice(0, 500))) {
    return `chore(${scope}): sensitive changes (${files.length} files)`
  }
  if (deletions > additions * 2) return `refactor(${scope}): simplify ${files.slice(0, 3).join(", ")}`
  if (diffText.includes("+    test") || files.some((f) => f.includes("test"))) return `test(${scope}): update tests`
  return `feat(${scope}: update ${files.length} file(s), +${additions}/-${deletions})`
}

async function prAssistant(ctx: PluginContext): Promise<number | void> {
  const cwd = path.resolve(ctx.cwd, ctx.args.find((a) => !a.startsWith("-")) ?? ".")
  const branch = Bun.spawn(["git", "rev-parse", "--abbrev-ref", "HEAD"], { cwd, stdout: "pipe", stderr: "ignore" })
  if ((await branch.exited) !== 0) {
    ctx.err("Not a git repository")
    return 1
  }
  const branchName = (await new Response(branch.stdout).text()).trim()

  const baseDiff = await diff(cwd, false)
  const files = [...new Set([...baseDiff.matchAll(/^diff --git a\/(\S+)/gm)].map((m) => m[1]))]

  let body = ""
  if (ctx.llm) {
    ctx.out(`${Icon.brain} Generating PR description with AI...`)
    body = await ctx.llm.generate(
      `Write a GitHub PR description (## Summary bullets + ## Test plan) for these changes:\nFiles: ${files.join(", ")}\n\n${baseDiff.slice(0, 6000)}`,
    )
  } else {
    body = [`## Summary`, "", ...files.slice(0, 10).map((f) => `- Changes in \`${f}\``), "", "## Test Plan", "- [ ] Manual verification"].join("\n")
  }

  const title = `PR: ${branchName} (${files.length} files)`
  ctx.out(`${Icon.info} ${title}`)
  ctx.out(body)

  if (typeof ctx.flags.create === "boolean" && ctx.flags.create) {
    const gh = Bun.which("gh")
    if (!gh) {
      ctx.err("GitHub CLI ('gh') not installed — install it or create the PR manually.")
      return 1
    }
    const proc = Bun.spawn(["gh", "pr", "create", "--title", title, "--body", body], { cwd, stdout: "inherit", stderr: "inherit" })
    return (await proc.exited) === 0 ? 0 : 1
  }
  ctx.out(`${Style.TEXT_DIM}Create with: nexus gitpro pr --create${Style.TEXT_NORMAL}`)
}

const plugin: NexusPlugin = {
  name: "gitpro",
  version: "0.1.0",
  description: "Smart Git assistant with pre-commit review and message generation",
  tags: ["git", "commit", "review"],
  commands: [
    {
      name: "review",
      describe: "review staged/unstaged/untracked changes for secrets and issues",
      usage: "nexus gitpro review",
      run: async (ctx) => {
        const cwd = path.resolve(ctx.cwd, ctx.args.find((a) => !a.startsWith("-")) ?? ".")
        let findings = review(await diff(cwd, false))

        if (findings.length === 0) {
          for (const file of await untrackedFiles(cwd)) {
            const content = await Bun.file(path.join(cwd, file)).text().catch(() => "")
            if (content) findings = [...findings, ...scanPlainFile(file, content)]
          }
        }

        if (findings.length === 0) {
          ctx.out(`${Icon.success} No issues found`)
          return 0
        }
        for (const finding of findings) {
          ctx.out(`  ${finding.severity.toUpperCase()} ${finding.file}:${finding.line} ${finding.message}`)
        }
        return 1
      },
    },
    {
      name: "commit",
      describe: "review + generate message + commit in one step",
      usage: 'nexus gitpro commit [-m "message"] [--no-verify] [--dry-run]',
      run: commit,
    },
    {
      name: "pr",
      describe: "generate PR description from diff (--create uses gh CLI)",
      usage: "nexus gitpro pr [--create]",
      run: prAssistant,
    },
  ],
}

export default plugin

export * as GitProPlugin from "./gitpro"
