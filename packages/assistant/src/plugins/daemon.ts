import path from "path"
import os from "os"
import { Style, Icon } from "../core/style"
import type { NexusPlugin, PluginContext } from "../core/types"

const EOL = "\n"
const DAEMON_DIR = path.join(os.homedir(), ".nexus", "daemon")
const PID_FILE = path.join(DAEMON_DIR, "serve.pid")
const WATCHDOG_PID_FILE = path.join(DAEMON_DIR, "watchdog.pid")
const LOG_FILE = path.join(DAEMON_DIR, "daemon.log")
const STOP_FLAG = path.join(DAEMON_DIR, "stop.flag")
const PORT = Number(process.env.NEXUS_PORT ?? 4096)

function isAlive(pid: number): boolean {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function readPid(file: string): number {
  return parseInt((require("fs").readFileSync(file, "utf8") as string).trim() || "0")
}

async function ensureDir(): Promise<void> {
  await import("fs/promises").then((fs) => fs.mkdir(DAEMON_DIR, { recursive: true }))
}

function serverCommand(): string {
  const override = process.env.NEXUS_DAEMON_CMD
  if (override) return override
  const installed = Bun.which("nexus")
  if (installed) return `${installed} serve --port ${PORT}`
  const localBin = path.join(os.homedir(), ".nexus", "bin", "nexus")
  if (require("fs").existsSync(localBin)) return `"${localBin}" serve --port ${PORT}`
  return `bun src/index.ts serve --port ${PORT}`
}

async function start(ctx: PluginContext): Promise<number | void> {
  await ensureDir()
  await import("fs/promises").then((fs) => fs.rm(STOP_FLAG, { force: true }))

  let existingPid = 0
  try {
    existingPid = readPid(PID_FILE)
  } catch {}
  if (existingPid && isAlive(existingPid)) {
    ctx.out(`${Icon.info} Daemon already running (pid ${existingPid}) — http://localhost:${PORT}`)
    ctx.out(`${Style.TEXT_DIM}Logs: tail -f ${LOG_FILE}${Style.TEXT_NORMAL}`)
    return 0
  }

  if (Bun.which("termux-wake-lock")) {
    Bun.spawn(["termux-wake-lock"], { stdout: "ignore", stderr: "ignore" })
    ctx.out(`${Icon.success} Wake-lock acquired (Android sleep se bacha)`)
  }

  const cmd = serverCommand()
  const inner = `exec ${cmd} >> "${LOG_FILE}" 2>&1`
  const proc = Bun.spawn(["setsid", "bash", "-c", inner], { stdin: "ignore", stdout: "ignore", stderr: "ignore", detached: true })
  proc.unref()
  await Bun.write(PID_FILE, String(proc.pid))

  await new Promise((r) => setTimeout(r, 2000))

  if (!isAlive(proc.pid)) {
    ctx.err("Server start nahi hua — logs:")
    const logTail = await Bun.file(LOG_FILE).text().catch(() => "")
    ctx.err(logTail.split(EOL).slice(-8).join(EOL))
    return 1
  }

  const watchdog = [
    "#!/data/data/com.termux/files/usr/bin/bash",
    `cd "$HOME"`,
    `trap 'exit 0' INT TERM`,
    `while true; do`,
    `  [ -f "${STOP_FLAG}" ] && exit 0`,
    `  pid=$(cat "${PID_FILE}" 2>/dev/null || echo 0)`,
    `  if ! kill -0 "$pid" 2>/dev/null; then`,
    `    echo "[$(date)] crashed — restarting" >> "${LOG_FILE}"`,
    `    ${cmd} >> "${LOG_FILE}" 2>&1 &`,
    `    echo $! > "${PID_FILE}"`,
    `  fi`,
    `  mem=$(grep MemAvailable /proc/meminfo 2>/dev/null | awk '{print int($2/1024)"MB"}')`,
    `  echo "[$(date)] alive pid=$pid free_mem=$mem" >> "${DAEMON_DIR}/health.log"`,
    `  if command -v termux-notification >/dev/null 2>&1 && [ -f "${DAEMON_DIR}/notify.flag" ]; then`,
    `    rm -f "${DAEMON_DIR}/notify.flag"`,
    `    termux-notification --title "NEXUS daemon" --content "Restarted, running on :${PORT}" >/dev/null 2>&1`,
    `  fi`,
    `  sleep 30`,
    `done`,
  ].join(EOL)

  const wdScript = path.join(DAEMON_DIR, "watchdog.sh")
  await Bun.write(wdScript, watchdog)
  await import("fs/promises").then((fs) => fs.chmod(wdScript, 0o755))

  const wdProc = Bun.spawn(["setsid", "bash", wdScript], { stdin: "ignore", stdout: "ignore", stderr: "ignore", detached: true })
  wdProc.unref()
  await Bun.write(WATCHDOG_PID_FILE, String(wdProc.pid))

  ctx.out(`${Icon.rocket} Daemon STARTED`)
  ctx.out(`  Server   : http://localhost:${PORT} (pid ${proc.pid})`)
  ctx.out(`  Watchdog : pid ${wdProc.pid} — crash = auto-restart in 30s`)
  ctx.out(`  Logs     : tail -f ${LOG_FILE}`)
  ctx.out(`${EOL}${Style.TEXT_NORMAL_BOLD}Keep-alive checklist (Android):${Style.TEXT_NORMAL}`)
  ctx.out(`  1. Settings → Apps → Termux → Battery → ${Style.TEXT_WARNING_BOLD}No restrictions${Style.TEXT_NORMAL}`)
  ctx.out(`  2. Notification lock karo (pin)`)
  ctx.out(`  3. Auto-start on reboot: ${Style.TEXT_HIGHLIGHT}nexus assistant daemon autostart${Style.TEXT_NORMAL}`)
  ctx.out(`  4. Remote connect (PC se): ${Style.TEXT_HIGHLIGHT}pkg install openssh && sshd${Style.TEXT_NORMAL}`)
}

async function stop(ctx: PluginContext): Promise<number | void> {
  let stopped = false
  await Bun.write(STOP_FLAG, String(Date.now()))
  const killTree = (pid: number): void => {
    try {
      const children = Bun.spawnSync(["pgrep", "-P", String(pid)], { stdout: "pipe" })
        .stdout.toString().trim().split("\n").filter(Boolean).map(Number)
      for (const child of children) killTree(child)
      if (isAlive(pid)) process.kill(pid)
      stopped = true
    } catch {}
  }
  try {
    killTree(readPid(WATCHDOG_PID_FILE))
  } catch {}
  try {
    killTree(readPid(PID_FILE))
  } catch {}
  // kill any orphaned serve process matching our port script
  const pkill = Bun.spawn(["sh", "-c", "pkill -f 'serve --port " + PORT + "' 2>/dev/null; true"], { stdout: "ignore", stderr: "ignore" })
  await pkill.exited
  if (Bun.which("termux-wake-unlock")) Bun.spawn(["termux-wake-unlock"], { stdout: "ignore", stderr: "ignore" })
  ctx.out(stopped ? `${Icon.success} Daemon stopped` : `${Icon.warn} Daemon was not running`)
  return 0
}

async function status(ctx: PluginContext): Promise<number | void> {
  let servePid = 0
  let wdPid = 0
  try {
    servePid = readPid(PID_FILE)
  } catch {}
  try {
    wdPid = readPid(WATCHDOG_PID_FILE)
  } catch {}

  const serveAlive = isAlive(servePid)
  const wdAlive = isAlive(wdPid)

  ctx.out(`${Icon.robot} NEXUS Daemon Status`)
  ctx.out(`  Server   : ${serveAlive ? ok(`running (pid ${servePid})`) : bad("stopped")}  http://localhost:${PORT}`)
  ctx.out(`  Watchdog : ${wdAlive ? ok(`active (pid ${wdPid})`) : bad("inactive")}`)

  try {
    const res = await fetch(`http://localhost:${PORT}/`, { signal: AbortSignal.timeout(3000) })
    ctx.out(`  Health   : ${ok(`HTTP ${res.status}`)}`)
  } catch {
    ctx.out(`  Health   : ${bad("no response")}`)
  }

  const healthLog = Bun.file(path.join(DAEMON_DIR, "health.log"))
  if (await healthLog.exists()) {
    const lines = (await healthLog.text()).trim().split(EOL)
    ctx.out(`${EOL}  ${Style.TEXT_DIM}Last check: ${lines[lines.length - 1] ?? "-"}${Style.TEXT_NORMAL}`)
  }

  if (!serveAlive) ctx.out(`${EOL}${Style.TEXT_DIM}Start: nexus assistant daemon start${Style.TEXT_NORMAL}`)
  return serveAlive ? 0 : 1
}

async function autostart(ctx: PluginContext): Promise<number | void> {
  const bootDir = path.join(os.homedir(), ".termux", "boot")
  if (!process.env.PREFIX?.includes("com.termux")) {
    ctx.err("Autostart Termux:Boot ke saath kaam karta hai (Android only)")
    return 1
  }
  await import("fs/promises").then((fs) => fs.mkdir(bootDir, { recursive: true }))
  const script = path.join(bootDir, "nexus-daemon.sh")
  const content = [
    "#!/data/data/com.termux/files/usr/bin/bash",
    "termux-wake-lock",
    "sleep 10",
    'nexus assistant daemon start >/dev/null 2>&1 &',
  ].join(EOL)
  await Bun.write(script, content)
  await import("fs/promises").then((fs) => fs.chmod(script, 0o755))
  ctx.out(`${Icon.success} Boot script written: ${script}`)
  ctx.out(`  ${Style.TEXT_DIM}Termux:Boot app install karo (F-Droid) — reboot pe daemon khud start hoga${Style.TEXT_NORMAL}`)
}

async function remote(ctx: PluginContext): Promise<number | void> {
  ctx.out(`${Icon.info} ${Style.TEXT_NORMAL_BOLD}Phone ko kahin se bhi connect karne ke tarike:${Style.TEXT_NORMAL}`)
  ctx.out(`${EOL}  ${Style.TEXT_NORMAL_BOLD}1. Same WiFi (laptop → phone):${Style.TEXT_NORMAL}`)
  ctx.out(`     pkg install openssh && passwd && sshd`)
  ctx.out(`     PC se: ssh -p 8022 phone-ip  |  Agent API: http://phone-ip:${PORT}`)
  ctx.out(`${EOL}  ${Style.TEXT_NORMAL_BOLD}2. Internet se kahin bhi (recommended):${Style.TEXT_NORMAL}`)
  ctx.out(`     Tailscale install dono devices pe (free) → private VPN IP milta hai`)
  ctx.out(`     phir chahe tum kahan ho: http://phone-tailscale-ip:${PORT}`)
  ctx.out(`${EOL}  ${Style.TEXT_NORMAL_BOLD}3. Attach CLI se:${Style.TEXT_NORMAL}`)
  ctx.out(`     nexus attach http://<ip>:${PORT}`)
  ctx.out(`${EOL}${Style.TEXT_DIM}Note: direct internet-expose mat karo — Tailscale/WireGuard tunnel hi safe hai.${Style.TEXT_NORMAL}`)
}

const plugin: NexusPlugin = {
  name: "daemon",
  version: "0.1.0",
  description: "24x7 agent daemon — crash auto-restart, wake-lock, load logging, remote access",
  tags: ["daemon", "24x7", "server", "watchdog"],
  commands: [
    { name: "start", describe: "start persistent AI server + watchdog (wake-lock included)", usage: "nexus daemon start", run: start },
    { name: "stop", describe: "stop daemon + watchdog + wake-lock release", usage: "nexus daemon stop", run: stop },
    { name: "status", describe: "live status: process, health, memory, last check", usage: "nexus daemon status", run: status },
    { name: "autostart", describe: "register boot-time auto-start (Termux:Boot)", usage: "nexus daemon autostart", run: autostart },
    { name: "remote", describe: "remote access setup guide (SSH/Tailscale)", usage: "nexus daemon remote", run: remote },
  ],
}

export default plugin

export * as DaemonPlugin from "./daemon"

function ok(text: string): string {
  return `\x1b[92m${text}\x1b[0m`
}
function bad(text: string): string {
  return `\x1b[91m${text}\x1b[0m`
}
