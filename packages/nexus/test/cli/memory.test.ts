import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  addLocalMemory,
  containsSensitiveMemoryValue,
  formatMemoryList,
  getLocalMemory,
  listLocalMemories,
  memoryStatus,
  removeLocalMemory,
} from "../../src/cli/cmd/memory"

describe("local permanent memory", () => {
  test("creates memory only from an explicit bounded add and lists newest entries first", () => {
    const stateDirectory = mkdtempSync(join(tmpdir(), "nexus-memory-"))
    try {
      expect(memoryStatus(stateDirectory)).toMatchObject({ initialized: false, entries: 0 })
      const older = addLocalMemory({ stateDirectory, title: "project preference", value: "Prefer tests before merge", createdAt: 1 })
      const newer = addLocalMemory({ stateDirectory, title: "device note", value: "Use Termux command-first ergonomics", createdAt: 2 })

      expect(memoryStatus(stateDirectory)).toMatchObject({ initialized: true, entries: 2 })
      expect(listLocalMemories({ stateDirectory, limit: 1 })).toEqual([newer])
      expect(listLocalMemories({ stateDirectory })).toEqual([newer, older])
    } finally {
      rmSync(stateDirectory, { recursive: true, force: true })
    }
  })

  test("rejects sensitive-looking additions before persistence and redacts defensive display output", () => {
    const stateDirectory = mkdtempSync(join(tmpdir(), "nexus-memory-"))
    try {
      expect(containsSensitiveMemoryValue("password=correct-horse-battery-staple")).toBe(true)
      expect(containsSensitiveMemoryValue("NEXUS_TOKEN=private-token-value-123456")).toBe(true)
      expect(() => addLocalMemory({ stateDirectory, title: "credential", value: "password=correct-horse-battery-staple" })).toThrow(
        "looks sensitive",
      )
      expect(listLocalMemories({ stateDirectory })).toEqual([])
      expect(
        formatMemoryList([{ id: 1, title: "manual", value: "Bearer private-token-value-123456", createdAt: 1 }], "table"),
      ).toContain("[redacted: sensitive-looking value]")
    } finally {
      rmSync(stateDirectory, { recursive: true, force: true })
    }
  })

  test("shows one memory without mutation and removes only one confirmed positive ID", () => {
    const stateDirectory = mkdtempSync(join(tmpdir(), "nexus-memory-"))
    try {
      const first = addLocalMemory({ stateDirectory, title: "first", value: "keep this", createdAt: 1 })
      const second = addLocalMemory({ stateDirectory, title: "second", value: "remove this", createdAt: 2 })

      expect(getLocalMemory({ stateDirectory, id: second.id })).toEqual(second)
      expect(() => removeLocalMemory({ stateDirectory, id: second.id, confirmed: false })).toThrow("requires --confirm")
      expect(listLocalMemories({ stateDirectory })).toEqual([second, first])
      expect(removeLocalMemory({ stateDirectory, id: second.id, confirmed: true })).toEqual(second)
      expect(getLocalMemory({ stateDirectory, id: second.id })).toBeUndefined()
      expect(listLocalMemories({ stateDirectory })).toEqual([first])
      expect(() => getLocalMemory({ stateDirectory, id: 0 })).toThrow("positive integer")
      expect(removeLocalMemory({ stateDirectory, id: 999, confirmed: true })).toBeUndefined()
    } finally {
      rmSync(stateDirectory, { recursive: true, force: true })
    }
  })

  test("does not create local storage when a bounded show or remove target is absent", () => {
    const stateDirectory = mkdtempSync(join(tmpdir(), "nexus-memory-"))
    try {
      expect(getLocalMemory({ stateDirectory, id: 1 })).toBeUndefined()
      expect(removeLocalMemory({ stateDirectory, id: 1, confirmed: true })).toBeUndefined()
      expect(() => removeLocalMemory({ stateDirectory, id: 1, confirmed: false })).toThrow("requires --confirm")
      expect(memoryStatus(stateDirectory)).toMatchObject({ initialized: false, entries: 0 })
    } finally {
      rmSync(stateDirectory, { recursive: true, force: true })
    }
  })
})
