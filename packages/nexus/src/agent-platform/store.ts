import { Database } from "bun:sqlite"
import { createHash, randomUUID } from "node:crypto"
import { mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { Global } from "@nexus-ai/core/global"
import { redactSensitive } from "@nexus-ai/assistant/core/redact"

export const AGENT_PLATFORM_SCHEMA_VERSION = 1

export type MemoryScope = "device" | "project" | "channel"
export type MemoryKind = "fact" | "preference" | "decision" | "summary" | "instruction"
export type LearningStatus = "proposed" | "approved" | "rejected" | "superseded"
export type RunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled" | "interrupted"

export type RunPolicy = {
  maxChildren: number
  maxParallel: number
  budgetClass: "low" | "standard" | "high"
}

export type AgentRun = {
  id: string
  parentRunId?: string
  mode: "interactive" | "scheduled" | "channel"
  status: RunStatus
  policy: RunPolicy
  idempotencyKey?: string
  requestedAt: number
  startedAt?: number
  completedAt?: number
}

export type MemoryRecord = {
  id: string
  scope: MemoryScope
  scopeId: string
  kind: MemoryKind
  content: string
  sourceRunId?: string
  confidence: number
  status: "active" | "superseded" | "deleted"
  createdAt: number
  updatedAt: number
}

export type LearningProposal = {
  id: string
  runId: string
  title: string
  summary: string
  skillDraft: string
  evidence: string[]
  status: LearningStatus
  createdAt: number
  reviewedAt?: number
}

export type AgentSchedule = {
  id: string
  name: string
  expression: string
  timezone: string
  payload: string
  enabled: boolean
  createdAt: number
  updatedAt: number
}

type StoreOptions = { path?: string }

function now() {
  return Date.now()
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex")
}

function asBoolean(value: unknown) {
  return Number(value) === 1
}

function decodeMemory(row: Record<string, unknown>): MemoryRecord {
  return {
    id: String(row.id),
    scope: row.scope as MemoryScope,
    scopeId: String(row.scope_id),
    kind: row.kind as MemoryKind,
    content: String(row.content),
    sourceRunId: typeof row.source_run_id === "string" ? row.source_run_id : undefined,
    confidence: Number(row.confidence),
    status: row.status as MemoryRecord["status"],
    createdAt: Number(row.time_created),
    updatedAt: Number(row.time_updated),
  }
}

function decodeLearning(row: Record<string, unknown>): LearningProposal {
  return {
    id: String(row.id),
    runId: String(row.run_id),
    title: String(row.title),
    summary: String(row.summary),
    skillDraft: String(row.skill_draft),
    evidence: JSON.parse(String(row.evidence_json)) as string[],
    status: row.status as LearningStatus,
    createdAt: Number(row.time_created),
    reviewedAt: row.time_reviewed == null ? undefined : Number(row.time_reviewed),
  }
}

function decodeRun(row: Record<string, unknown>): AgentRun {
  return {
    id: String(row.id),
    parentRunId: typeof row.parent_run_id === "string" ? row.parent_run_id : undefined,
    mode: row.mode as AgentRun["mode"],
    status: row.status as RunStatus,
    policy: JSON.parse(String(row.policy_json)) as RunPolicy,
    idempotencyKey: typeof row.idempotency_key === "string" ? row.idempotency_key : undefined,
    requestedAt: Number(row.time_requested),
    startedAt: row.time_started == null ? undefined : Number(row.time_started),
    completedAt: row.time_completed == null ? undefined : Number(row.time_completed),
  }
}

export function defaultAgentPlatformPath() {
  return process.env.NEXUS_AGENT_DB || join(Global.Path.data, "agent-platform.db")
}

/**
 * Local-first durable storage for the agent foundation. It keeps its own
 * versioned SQLite file so agent-platform migrations cannot alter existing
 * session, account, or API-vault storage.
 */
export class AgentPlatformStore {
  readonly path: string
  private readonly db: Database

  constructor(options: StoreOptions = {}) {
    this.path = options.path ?? defaultAgentPlatformPath()
    mkdirSync(dirname(this.path), { recursive: true })
    this.db = new Database(this.path, { create: true })
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;")
    this.migrate()
  }

  close() {
    this.db.close()
  }

  private migrate() {
    const row = this.db.query("PRAGMA user_version").get() as { user_version?: number } | null
    const version = Number(row?.user_version ?? 0)
    if (version >= AGENT_PLATFORM_SCHEMA_VERSION) return
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agent_memory (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL,
        scope_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        content TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        source_run_id TEXT,
        confidence REAL NOT NULL,
        status TEXT NOT NULL,
        time_created INTEGER NOT NULL,
        time_updated INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS agent_memory_active_unique
        ON agent_memory(scope, scope_id, content_hash) WHERE status = 'active';
      CREATE INDEX IF NOT EXISTS agent_memory_scope_updated ON agent_memory(scope, scope_id, time_updated DESC);

      CREATE TABLE IF NOT EXISTS agent_learning_proposal (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        skill_draft TEXT NOT NULL,
        evidence_json TEXT NOT NULL,
        status TEXT NOT NULL,
        time_created INTEGER NOT NULL,
        time_reviewed INTEGER
      );
      CREATE TABLE IF NOT EXISTS agent_skill_revision (
        id TEXT PRIMARY KEY,
        proposal_id TEXT NOT NULL UNIQUE REFERENCES agent_learning_proposal(id),
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        content_hash TEXT NOT NULL UNIQUE,
        revision INTEGER NOT NULL,
        time_created INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS agent_run (
        id TEXT PRIMARY KEY,
        parent_run_id TEXT REFERENCES agent_run(id),
        mode TEXT NOT NULL,
        status TEXT NOT NULL,
        policy_json TEXT NOT NULL,
        idempotency_key TEXT,
        time_requested INTEGER NOT NULL,
        time_started INTEGER,
        time_completed INTEGER
      );
      CREATE UNIQUE INDEX IF NOT EXISTS agent_run_idempotency_unique
        ON agent_run(idempotency_key) WHERE idempotency_key IS NOT NULL;

      CREATE TABLE IF NOT EXISTS agent_schedule (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        expression TEXT NOT NULL,
        timezone TEXT NOT NULL,
        payload TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 0,
        time_created INTEGER NOT NULL,
        time_updated INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS agent_audit (
        id TEXT PRIMARY KEY,
        action TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        detail_json TEXT NOT NULL,
        time_created INTEGER NOT NULL
      );
      PRAGMA user_version = ${AGENT_PLATFORM_SCHEMA_VERSION};
    `)
  }

  addMemory(input: Omit<MemoryRecord, "id" | "content" | "createdAt" | "updatedAt" | "status"> & { content: string }) {
    const content = redactSensitive(input.content).trim()
    if (!content) throw new Error("Memory content is empty after redaction")
    const timestamp = now()
    const id = randomUUID()
    this.db
      .query(
        `INSERT INTO agent_memory (id, scope, scope_id, kind, content, content_hash, source_run_id, confidence, status, time_created, time_updated)
         VALUES ($id, $scope, $scopeId, $kind, $content, $contentHash, $sourceRunId, $confidence, 'active', $timestamp, $timestamp)
         ON CONFLICT DO UPDATE SET confidence = excluded.confidence, time_updated = excluded.time_updated`,
      )
      .run({
        $id: id,
        $scope: input.scope,
        $scopeId: input.scopeId,
        $kind: input.kind,
        $content: content,
        $contentHash: hash(content),
        $sourceRunId: input.sourceRunId ?? null,
        $confidence: Math.min(1, Math.max(0, input.confidence)),
        $timestamp: timestamp,
      })
    const stored = this.db.query("SELECT * FROM agent_memory WHERE scope = ? AND scope_id = ? AND content_hash = ? AND status = 'active'").get(input.scope, input.scopeId, hash(content)) as Record<string, unknown>
    return decodeMemory(stored)
  }

  listMemory(scope?: MemoryScope, scopeId?: string) {
    const rows = scope
      ? this.db.query("SELECT * FROM agent_memory WHERE scope = ? AND scope_id = ? AND status = 'active' ORDER BY time_updated DESC").all(scope, scopeId ?? "default")
      : this.db.query("SELECT * FROM agent_memory WHERE status = 'active' ORDER BY time_updated DESC").all()
    return (rows as Record<string, unknown>[]).map(decodeMemory)
  }

  searchMemory(query: string, scope: MemoryScope, scopeId: string) {
    const safeQuery = redactSensitive(query).trim().toLowerCase()
    if (!safeQuery) return []
    const rows = this.db
      .query("SELECT * FROM agent_memory WHERE scope = ? AND scope_id = ? AND status = 'active' AND lower(content) LIKE ? ORDER BY confidence DESC, time_updated DESC LIMIT 20")
      .all(scope, scopeId, `%${safeQuery}%`) as Record<string, unknown>[]
    return rows.map(decodeMemory)
  }

  proposeLearning(input: { runId: string; title: string; summary: string; skillDraft: string; evidence?: string[] }) {
    const proposal: LearningProposal = {
      id: randomUUID(),
      runId: input.runId,
      title: redactSensitive(input.title).trim(),
      summary: redactSensitive(input.summary).trim(),
      skillDraft: redactSensitive(input.skillDraft).trim(),
      evidence: (input.evidence ?? []).map(redactSensitive),
      status: "proposed",
      createdAt: now(),
    }
    if (!proposal.title || !proposal.skillDraft) throw new Error("Learning proposal requires a title and redacted skill draft")
    this.db
      .query("INSERT INTO agent_learning_proposal (id, run_id, title, summary, skill_draft, evidence_json, status, time_created) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(proposal.id, proposal.runId, proposal.title, proposal.summary, proposal.skillDraft, JSON.stringify(proposal.evidence), proposal.status, proposal.createdAt)
    this.audit("learning.proposed", "learning_proposal", proposal.id, { runId: proposal.runId })
    return proposal
  }

  listLearning(status?: LearningStatus) {
    const rows = status
      ? this.db.query("SELECT * FROM agent_learning_proposal WHERE status = ? ORDER BY time_created DESC").all(status)
      : this.db.query("SELECT * FROM agent_learning_proposal ORDER BY time_created DESC").all()
    return (rows as Record<string, unknown>[]).map(decodeLearning)
  }

  approveLearning(id: string) {
    const row = this.db.query("SELECT * FROM agent_learning_proposal WHERE id = ?").get(id) as Record<string, unknown> | null
    if (!row) throw new Error(`Learning proposal not found: ${id}`)
    const proposal = decodeLearning(row)
    if (proposal.status !== "proposed") throw new Error(`Learning proposal is already ${proposal.status}`)
    const timestamp = now()
    this.db.transaction(() => {
      this.db.query("UPDATE agent_learning_proposal SET status = 'approved', time_reviewed = ? WHERE id = ?").run(timestamp, id)
      this.db.query("INSERT INTO agent_skill_revision (id, proposal_id, title, content, content_hash, revision, time_created) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(randomUUID(), id, proposal.title, proposal.skillDraft, hash(proposal.skillDraft), 1, timestamp)
    })()
    this.audit("learning.approved", "learning_proposal", id, {})
  }

  rejectLearning(id: string) {
    const result = this.db.query("UPDATE agent_learning_proposal SET status = 'rejected', time_reviewed = ? WHERE id = ? AND status = 'proposed'").run(now(), id)
    if (!result.changes) throw new Error(`No pending learning proposal found: ${id}`)
    this.audit("learning.rejected", "learning_proposal", id, {})
  }

  createRun(input: { mode?: AgentRun["mode"]; parentRunId?: string; idempotencyKey?: string; policy?: Partial<RunPolicy> }) {
    const policy: RunPolicy = {
      maxChildren: Math.max(0, Math.min(12, input.policy?.maxChildren ?? 2)),
      maxParallel: Math.max(1, Math.min(12, input.policy?.maxParallel ?? 3)),
      budgetClass: input.policy?.budgetClass ?? "standard",
    }
    if (policy.maxParallel > policy.maxChildren + 1) throw new Error("maxParallel cannot exceed lead plus maxChildren")
    const existing = input.idempotencyKey
      ? this.db.query("SELECT * FROM agent_run WHERE idempotency_key = ?").get(input.idempotencyKey) as Record<string, unknown> | null
      : null
    if (existing) return decodeRun(existing)
    const run: AgentRun = {
      id: randomUUID(),
      parentRunId: input.parentRunId,
      mode: input.mode ?? "interactive",
      status: "queued",
      policy,
      idempotencyKey: input.idempotencyKey,
      requestedAt: now(),
    }
    this.db.query("INSERT INTO agent_run (id, parent_run_id, mode, status, policy_json, idempotency_key, time_requested) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(run.id, run.parentRunId ?? null, run.mode, run.status, JSON.stringify(run.policy), run.idempotencyKey ?? null, run.requestedAt)
    this.audit("run.planned", "run", run.id, { policy: run.policy })
    return run
  }

  listRuns() {
    return (this.db.query("SELECT * FROM agent_run ORDER BY time_requested DESC").all() as Record<string, unknown>[]).map(decodeRun)
  }

  createSchedule(input: { name: string; expression: string; timezone?: string; payload: string }) {
    const timestamp = now()
    const schedule: AgentSchedule = {
      id: randomUUID(),
      name: input.name.trim(),
      expression: input.expression.trim(),
      timezone: input.timezone?.trim() || "UTC",
      payload: redactSensitive(input.payload).trim(),
      enabled: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    if (!schedule.name || !schedule.expression || !schedule.payload) throw new Error("Schedule name, expression, and payload are required")
    this.db.query("INSERT INTO agent_schedule (id, name, expression, timezone, payload, enabled, time_created, time_updated) VALUES (?, ?, ?, ?, ?, 0, ?, ?)")
      .run(schedule.id, schedule.name, schedule.expression, schedule.timezone, schedule.payload, timestamp, timestamp)
    this.audit("schedule.created", "schedule", schedule.id, { enabled: false })
    return schedule
  }

  listSchedules() {
    return (this.db.query("SELECT * FROM agent_schedule ORDER BY time_created DESC").all() as Record<string, unknown>[]).map((row) => ({
      id: String(row.id),
      name: String(row.name),
      expression: String(row.expression),
      timezone: String(row.timezone),
      payload: String(row.payload),
      enabled: asBoolean(row.enabled),
      createdAt: Number(row.time_created),
      updatedAt: Number(row.time_updated),
    } satisfies AgentSchedule))
  }

  private audit(action: string, entityType: string, entityId: string, detail: Record<string, unknown>) {
    this.db.query("INSERT INTO agent_audit (id, action, entity_type, entity_id, detail_json, time_created) VALUES (?, ?, ?, ?, ?, ?)")
      .run(randomUUID(), action, entityType, entityId, JSON.stringify(detail), now())
  }
}
