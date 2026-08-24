import { mkdir, rename, writeFile } from "node:fs/promises"
import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

export type TaskProfileName = "fast" | "balanced" | "deep" | "local"
export type TaskProfile = {
  name: TaskProfileName
  label: string
  maxParallel: number
  outputBudget: "small" | "standard" | "large"
  network: "allowed" | "confirm"
  preference: "speed" | "balanced" | "quality" | "offline"
}

export const TASK_PROFILES: Record<TaskProfileName, TaskProfile> = {
  fast: { name: "fast", label: "Fast", maxParallel: 2, outputBudget: "small", network: "allowed", preference: "speed" },
  balanced: { name: "balanced", label: "Balanced", maxParallel: 3, outputBudget: "standard", network: "allowed", preference: "balanced" },
  deep: { name: "deep", label: "Deep", maxParallel: 6, outputBudget: "large", network: "confirm", preference: "quality" },
  local: { name: "local", label: "Local/Offline", maxParallel: 2, outputBudget: "standard", network: "confirm", preference: "offline" },
}

const profilePath = process.env.NEXUS_TASK_PROFILE_PATH || join(homedir(), ".nexus", "task-profile.json")

export function currentTaskProfile() {
  try {
    const raw = JSON.parse(readFileSync(profilePath, "utf8")) as { profile?: unknown }
    if (typeof raw.profile === "string" && raw.profile in TASK_PROFILES) return TASK_PROFILES[raw.profile as TaskProfileName]
  } catch {}
  return TASK_PROFILES.balanced
}

export async function setTaskProfile(name: TaskProfileName) {
  const profile = TASK_PROFILES[name]
  await mkdir(join(profilePath, ".."), { recursive: true })
  const temporary = `${profilePath}.${process.pid}.tmp`
  await writeFile(temporary, JSON.stringify({ version: 1, profile: profile.name }, null, 2) + "\n", "utf8")
  await rename(temporary, profilePath)
  return profile
}

export function taskProfilePath() {
  return profilePath
}
