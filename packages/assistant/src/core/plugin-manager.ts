import path from "path"
import type { EnvironmentConfig, NexusPlugin } from "./types"

interface LoadedPlugin {
  plugin: NexusPlugin
  lastAccessed: number
}

const PLUGIN_DIR = path.join(import.meta.dir, "..", "plugins")

export class PluginManager {
  private loaded = new Map<string, LoadedPlugin>()
  private loading = new Map<string, Promise<NexusPlugin>>()
  private timers = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(private config: EnvironmentConfig) {}

  available(): string[] {
    return [
      "codegen",
      "devtools",
      "recovery",
      "workspace",
      "termux",
      "translator",
      "gitpro",
      "cpanel",
      "deploy",
      "webtest",
      "copilot",
      "integrations",
      "voice",
      "bg",
      "security",
      "daemon",
    ]
  }

  isDisabled(name: string): boolean {
    return this.config.disabledPlugins.includes(name)
  }

  async get(name: string): Promise<NexusPlugin> {
    if (!this.available().includes(name)) {
      throw new Error(`Unknown plugin: ${name}`)
    }
    if (this.isDisabled(name)) {
      throw new Error(`Plugin '${name}' is disabled on this device (${this.config.type})`)
    }

    const existing = this.loaded.get(name)
    if (existing) {
      existing.lastAccessed = Date.now()
      this.restartIdleTimer(name)
      return existing.plugin
    }

    const inFlight = this.loading.get(name)
    if (inFlight) return inFlight

    const promise = this.load(name)
    this.loading.set(name, promise)
    return promise.finally(() => this.loading.delete(name))
  }

  async loadCount(): Promise<number> {
    return this.loaded.size
  }

  private async load(name: string): Promise<NexusPlugin> {
    while (this.loaded.size >= this.config.maxPlugins) {
      await this.unloadLRU()
    }

    const mod = await import(path.join(PLUGIN_DIR, `${name}.ts`))
    const plugin: NexusPlugin = mod.default ?? mod.plugin

    if (!plugin?.name || !Array.isArray(plugin.commands)) {
      throw new Error(`Plugin '${name}' has an invalid shape`)
    }

    if (plugin.requires?.platform && !plugin.requires.platform.includes(process.platform)) {
      throw new Error(`Plugin '${name}' requires platform: ${plugin.requires.platform.join(", ")}`)
    }
    if (plugin.requires?.check) {
      const status = plugin.requires.check()
      if (!status.ok) throw new Error(`Plugin '${name}' unavailable: ${status.reason}`)
    }

    this.loaded.set(name, { plugin, lastAccessed: Date.now() })
    this.restartIdleTimer(name)
    return plugin
  }

  private async unloadLRU() {
    let oldest: string | undefined
    let oldestTime = Infinity
    for (const [name, entry] of this.loaded) {
      if (entry.lastAccessed < oldestTime) {
        oldestTime = entry.lastAccessed
        oldest = name
      }
    }
    if (oldest) await this.unload(oldest)
  }

  async unload(name: string) {
    this.clearTimer(name)
    this.loaded.delete(name)
    if (global.gc) global.gc()
  }

  private restartIdleTimer(name: string) {
    this.clearTimer(name)
    this.timers.set(
      name,
      setTimeout(() => {
        void this.unload(name)
      }, this.config.idleTimeoutMs),
    )
  }

  private clearTimer(name: string) {
    const timer = this.timers.get(name)
    if (timer) clearTimeout(timer)
    this.timers.delete(name)
  }
}

export * as PluginManagerModule from "./plugin-manager"
