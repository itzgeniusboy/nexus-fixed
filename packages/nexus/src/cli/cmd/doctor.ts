import { existsSync } from "node:fs"
import { mkdir, writeFile, rm } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { inspectDeviceGuard } from "@nexus/termux-core"
import { InstallationVersion } from "@nexus-ai/core/installation/version"
import { getApiVaultStatus } from "@/api/ApiVault"
import { currentTaskProfile, taskProfilePath } from "@/runtime/task-profile"

type DoctorReport = {
  version: string
  platform: "termux" | "desktop"
  runtime: { bun: string; prefix?: string }
  storage: { writable: boolean; path: string }
  termux: { apiCommand: boolean; batteryCommand: boolean; speechCommand: boolean }
  profile: ReturnType<typeof currentTaskProfile>
  providerVault: ReturnType<typeof getApiVaultStatus>
  deviceGuard: ReturnType<typeof inspectDeviceGuard>
}

function termuxCommand(name: string) {
  const prefix = process.env.PREFIX
  return Boolean(prefix && existsSync(join(prefix, "bin", name)))
}

async function storageCheck() {
  const path = join(homedir(), ".nexus")
  const probe = join(path, `.doctor-${process.pid}-${Date.now()}`)
  try {
    await mkdir(path, { recursive: true })
    await writeFile(probe, "ok", "utf8")
    await rm(probe, { force: true })
    return { writable: true, path }
  } catch {
    return { writable: false, path }
  }
}

export async function collectDoctorReport(): Promise<DoctorReport> {
  const termux = Boolean(process.env.TERMUX_VERSION || process.env.PREFIX?.includes("com.termux"))
  return {
    version: InstallationVersion,
    platform: termux ? "termux" : "desktop",
    runtime: { bun: Bun.version, prefix: process.env.PREFIX },
    storage: await storageCheck(),
    termux: {
      apiCommand: termuxCommand("termux-api-start") || termuxCommand("termux-battery-status"),
      batteryCommand: termuxCommand("termux-battery-status"),
      speechCommand: termuxCommand("termux-speech-to-text"),
    },
    profile: currentTaskProfile(),
    providerVault: getApiVaultStatus(),
    deviceGuard: inspectDeviceGuard(),
  }
}

function display(report: DoctorReport) {
  const check = (value: boolean) => (value ? "✓" : "!" )
  console.log(`NEXUS Doctor — v${report.version}`)
  console.log(`${check(true)} Platform: ${report.platform} · Bun ${report.runtime.bun}`)
  console.log(`${check(report.storage.writable)} Local storage: ${report.storage.path}`)
  console.log(`${check(true)} Task profile: ${report.profile.label} (${report.profile.preference}, max ${report.profile.maxParallel} parallel)`)
  console.log(`${check(true)} API vault: rotation ${report.providerVault.autoRotate ? "on" : "off"}, local fallback ${report.providerVault.fallbackToLocal ? "on" : "off"}`)
  if (report.platform === "termux") {
    console.log(`${check(report.termux.apiCommand)} Termux:API command available`)
    console.log(`${check(report.termux.batteryCommand)} Battery status command available`)
    console.log(`${check(report.termux.speechCommand)} Speech-to-text command available`)
  }
  console.log(`${check(report.deviceGuard.level !== "blocked")} Device guard: ${report.deviceGuard.level}`)
  for (const warning of report.deviceGuard.warnings) console.log(`! ${warning}`)
  if (report.deviceGuard.warnings.length === 0) console.log("✓ No device guard warning detected")
  console.log(`Profile file: ${taskProfilePath()}`)
}

export const DoctorCommand = {
  command: "doctor",
  describe: "check runtime, local storage, provider-vault mode, task profile, and Termux device safeguards",
  builder: (yargs: import("yargs").Argv) => yargs.option("json", { type: "boolean", describe: "print a machine-readable report" }),
  handler: async (args: { json?: boolean }) => {
    const report = await collectDoctorReport()
    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
      return
    }
    display(report)
  },
}
