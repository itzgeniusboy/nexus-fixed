import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

export type ProjectTargetKind = "web" | "node" | "android" | "unknown"

export type ProjectTarget = {
  kind: ProjectTargetKind
  root: string
  packageManager?: "bun" | "pnpm" | "yarn" | "npm"
  runCommands: string[]
  testCommands: string[]
  buildCommands: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function packageManager(root: string): ProjectTarget["packageManager"] {
  if (existsSync(join(root, "bun.lock")) || existsSync(join(root, "bun.lockb"))) return "bun"
  if (existsSync(join(root, "pnpm-lock.yaml"))) return "pnpm"
  if (existsSync(join(root, "yarn.lock"))) return "yarn"
  return "npm"
}

function scriptCommand(manager: NonNullable<ProjectTarget["packageManager"]>, script: string) {
  if (manager === "npm") return `npm run ${script}`
  return `${manager} run ${script}`
}

export function detectProjectTargets(root: string): ProjectTarget[] {
  const targets: ProjectTarget[] = []
  const hasAndroidBuild = [
    "gradlew",
    "gradlew.bat",
    "build.gradle",
    "build.gradle.kts",
    "settings.gradle",
    "settings.gradle.kts",
  ].some((file) => existsSync(join(root, file)))
  if (hasAndroidBuild || existsSync(join(root, "app", "build.gradle"))) {
    targets.push({
      kind: "android",
      root,
      runCommands: ["./gradlew tasks"],
      testCommands: ["./gradlew test", "./gradlew connectedCheck"],
      buildCommands: ["./gradlew assembleDebug", "./gradlew assembleRelease"],
    })
  }

  const packagePath = join(root, "package.json")
  if (!existsSync(packagePath))
    return targets.length ? targets : [{ kind: "unknown", root, runCommands: [], testCommands: [], buildCommands: [] }]

  try {
    const raw = JSON.parse(readFileSync(packagePath, "utf8")) as unknown
    const parsed = isRecord(raw) ? raw : {}
    const scripts = isRecord(parsed.scripts) ? parsed.scripts : {}
    const manager = packageManager(root)
    const hasWebDependency = [parsed.dependencies, parsed.devDependencies].some(
      (deps) =>
        isRecord(deps) &&
        ["react", "react-dom", "next", "vite", "expo", "@angular/core", "svelte"].some(
          (name) => deps[name] !== undefined,
        ),
    )
    const kind: ProjectTargetKind =
      hasWebDependency || scripts.dev !== undefined || scripts.start !== undefined ? "web" : "node"
    const runCommands = ["dev", "start"]
      .filter((name) => typeof scripts[name] === "string")
      .map((name) => scriptCommand(manager, name))
    const testCommands = ["test", "lint", "typecheck", "check"]
      .filter((name) => typeof scripts[name] === "string")
      .map((name) => scriptCommand(manager, name))
    const buildCommands = ["build", "compile"]
      .filter((name) => typeof scripts[name] === "string")
      .map((name) => scriptCommand(manager, name))
    targets.push({ kind, root, packageManager: manager, runCommands, testCommands, buildCommands })
  } catch {
    targets.push({ kind: "unknown", root, runCommands: [], testCommands: [], buildCommands: [] })
  }

  return targets
}
