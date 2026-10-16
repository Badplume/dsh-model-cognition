/**
 * The plugin's own store: providers, settings and the usage ledger.
 *
 * One JSON document under the Harness home's `data/` directory, which is where
 * the product keeps per-plugin data (`data/<plugin>/…`). Secret *values* never
 * land here when the credential service is available — a provider row carries a
 * credential key, and only the `inline` key mode keeps bytes in this file.
 *
 * Writes are atomic (temp file + rename) because the panel and the tools write
 * from the same Host process while a session may be mid-call, and a half-written
 * document would lose every provider the user configured.
 *
 * @module dsh-model-cognition/host/store
 */
import { mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { PACKAGE_NAME, SETTINGS_DEFAULTS, SETTINGS_KEYS, PROTOCOLS, KEY_MODES, USAGE_KEEP, APPROVAL_KEEP, APPROVAL_TTL_MS } from './constants.js'

/** Bumped when the document's shape changes; `migrate` folds older versions forward. */
export const STORE_VERSION = 1

/**
 * The Harness home directory, resolved the way the Host resolves it.
 *
 * The `dshHomePath` service joins the segments it is handed and is the
 * authority when present; `$DSH_HOME` and `~/.dsh` are the same fallbacks the
 * rest of the product uses.
 *
 * @param ctx - host plugin context.
 * @param segments - extra path segments under the Harness home.
 * @returns the resolved absolute path.
 */
export function harnessPath(ctx, ...segments) {
  const resolve = ctx?.get?.('dshHomePath')
  if (typeof resolve === 'function') return resolve(...segments)
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  return join(home, ...segments)
}

/** Absolute path of the store document for one Host context. */
export function storePath(ctx) {
  return harnessPath(ctx, 'data', PACKAGE_NAME, 'store.json')
}

/** A settings object carrying every key, with store values winning over defaults. */
function normalizeSettings(raw) {
  const settings = { ...SETTINGS_DEFAULTS }
  if (raw === null || typeof raw !== 'object') return settings
  for (const key of SETTINGS_KEYS) {
    const value = raw[key]
    if (value === undefined || value === null) continue
    const fallback = SETTINGS_DEFAULTS[key]
    if (typeof fallback === 'number' && Number.isFinite(Number(value))) settings[key] = Number(value)
    else if (typeof fallback === 'boolean') settings[key] = Boolean(value)
    else if (typeof fallback === 'string') settings[key] = String(value)
  }
  return settings
}

/** One model row, with finite prices or `null` when the user has not priced it. */
function normalizeModel(raw) {
  if (raw === null || typeof raw !== 'object') return null
  const id = typeof raw.id === 'string' ? raw.id.trim() : ''
  if (id === '') return null
  const price = (value) => {
    const number = Number(value)
    return Number.isFinite(number) && number >= 0 ? number : null
  }
  return {
    id,
    label: typeof raw.label === 'string' ? raw.label.trim() : '',
    inputPer1M: price(raw.inputPer1M),
    outputPer1M: price(raw.outputPer1M),
  }
}

/** One provider row, with every field the adapters and the panel read. */
export function normalizeProvider(raw) {
  if (raw === null || typeof raw !== 'object') return null
  const id = typeof raw.id === 'string' ? raw.id.trim() : ''
  if (id === '') return null
  const protocol = PROTOCOLS.includes(raw.protocol) ? raw.protocol : 'openai'
  const keyMode = KEY_MODES.includes(raw.keyMode) ? raw.keyMode : 'record'
  const models = Array.isArray(raw.models) ? raw.models.map(normalizeModel).filter(Boolean) : []
  // Two rows may not name the same model: lookup by id assumes one price.
  const seen = new Set()
  const unique = models.filter((model) => (seen.has(model.id) ? false : (seen.add(model.id), true)))
  const headers = raw.extraHeaders !== null && typeof raw.extraHeaders === 'object' && !Array.isArray(raw.extraHeaders)
    ? Object.fromEntries(
        Object.entries(raw.extraHeaders)
          .filter(([name, value]) => typeof name === 'string' && name !== '' && typeof value === 'string'),
      )
    : {}
  return {
    id,
    label: typeof raw.label === 'string' && raw.label.trim() !== '' ? raw.label.trim() : id,
    protocol,
    baseUrl: typeof raw.baseUrl === 'string' ? raw.baseUrl.trim().replace(/\/+$/, '') : '',
    keyMode,
    // Only ever populated in `inline` mode; `record` mode keeps the key in the
    // credential store and this field stays empty.
    apiKey: typeof raw.apiKey === 'string' ? raw.apiKey : '',
    enabled: raw.enabled !== false,
    models: unique,
    extraHeaders: headers,
    // `max_tokens` is the OpenAI-compatible default; a vendor that renamed the
    // field (or refuses it, like some reasoning models) is fixed here.
    maxTokensParam: ['max_tokens', 'max_completion_tokens', 'none'].includes(raw.maxTokensParam)
      ? raw.maxTokensParam
      : 'max_tokens',
    keyless: raw.keyless === true,
    notes: typeof raw.notes === 'string' ? raw.notes : '',
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString(),
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString(),
  }
}

/** One usage record: what was called, what it cost, and whether it worked. */
function normalizeUsageRecord(raw) {
  if (raw === null || typeof raw !== 'object') return null
  const number = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0)
  return {
    at: typeof raw.at === 'string' ? raw.at : new Date().toISOString(),
    provider: String(raw.provider ?? ''),
    model: String(raw.model ?? ''),
    purpose: String(raw.purpose ?? ''),
    promptTokens: number(raw.promptTokens),
    completionTokens: number(raw.completionTokens),
    costUsd: Number.isFinite(Number(raw.costUsd)) ? Number(raw.costUsd) : null,
    ms: number(raw.ms),
    ok: raw.ok !== false,
    error: typeof raw.error === 'string' ? raw.error.slice(0, 400) : undefined,
  }
}

/**
 * One budget approval: a call the guard priced above the auto-approve
 * threshold, waiting for the user to say yes or no in the panel.
 *
 * The grant is one-shot and content-shaped: it names the provider, model and a
 * digest of the prompt, so approving an estimate cannot be replayed against a
 * different question later.
 */
function normalizeApproval(raw) {
  if (raw === null || typeof raw !== 'object') return null
  const id = typeof raw.id === 'string' ? raw.id : ''
  if (id === '') return null
  const status = ['pending', 'approved', 'denied'].includes(raw.status) ? raw.status : 'pending'
  return {
    id,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString(),
    provider: String(raw.provider ?? ''),
    model: String(raw.model ?? ''),
    purpose: String(raw.purpose ?? ''),
    promptTokens: Number.isFinite(Number(raw.promptTokens)) ? Number(raw.promptTokens) : 0,
    maxTokens: Number.isFinite(Number(raw.maxTokens)) ? Number(raw.maxTokens) : 0,
    usd: Number.isFinite(Number(raw.usd)) ? Number(raw.usd) : null,
    digest: typeof raw.digest === 'string' ? raw.digest : '',
    preview: typeof raw.preview === 'string' ? raw.preview.slice(0, 280) : '',
    status,
    decidedAt: typeof raw.decidedAt === 'string' ? raw.decidedAt : '',
    consumedAt: typeof raw.consumedAt === 'string' ? raw.consumedAt : '',
  }
}

/** The empty document a fresh install starts from. */
export function emptyStore(seed = {}) {
  return {
    version: STORE_VERSION,
    settings: normalizeSettings(seed),
    providers: [],
    usage: { records: [], totals: { calls: 0, failed: 0, promptTokens: 0, completionTokens: 0, costUsd: 0 } },
    approvals: [],
  }
}

/**
 * Read the document, keeping "absent" distinct from "unreadable".
 *
 * The distinction is the whole safety property of this file. An absent
 * document is a fresh install and may be seeded; an unreadable one (a lock, a
 * permission fault, a half-visible network path) must never be treated as
 * absent, because the caller would then write a fresh empty document over a
 * provider list the user still has.
 *
 * @param path - the store document.
 * @returns `{ kind: 'ok', raw }`, `{ kind: 'missing' }`, `{ kind: 'corrupt' }`
 *          or `{ kind: 'unreadable', error }`.
 */
function readDocument(path) {
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    return error?.code === 'ENOENT' ? { kind: 'missing' } : { kind: 'unreadable', error }
  }
  try {
    const parsed = JSON.parse(text)
    if (parsed === null || typeof parsed !== 'object') return { kind: 'corrupt' }
    return { kind: 'ok', raw: parsed }
  } catch {
    return { kind: 'corrupt' }
  }
}

/** A change token for the document, so a re-read can be skipped when nothing moved. */
function documentStamp(path) {
  try {
    const stats = statSync(path)
    return `${stats.mtimeMs}:${stats.size}`
  } catch {
    return null
  }
}

/** Move a corrupt document aside; the user's bytes outlive the fresh one. */
function quarantine(path) {
  try {
    renameSync(path, `${path}.corrupt-${Date.now()}`)
  } catch { /* the backup is best-effort; the fresh document still lands */ }
}

/** Fold a document of any older version forward. */
function migrate(raw) {
  // Version 1 is the first shape; a document without a version is treated as
  // version 1 because every field is normalized individually below.
  return raw
}

/** Rebuild a document from disk input, dropping anything malformed. */
function normalizeStore(raw, seed) {
  const base = emptyStore(seed)
  if (raw === null || typeof raw !== 'object') return base
  const migrated = migrate(raw)
  const providers = []
  const ids = new Set()
  if (Array.isArray(migrated.providers)) {
    for (const entry of migrated.providers) {
      const provider = normalizeProvider(entry)
      if (provider === null || ids.has(provider.id)) continue
      ids.add(provider.id)
      providers.push(provider)
    }
  }
  const records = Array.isArray(migrated.usage?.records)
    ? migrated.usage.records.map(normalizeUsageRecord).filter(Boolean).slice(-USAGE_KEEP)
    : []
  const approvals = Array.isArray(migrated.approvals)
    ? migrated.approvals.map(normalizeApproval).filter(Boolean).slice(-APPROVAL_KEEP)
    : []
  return {
    version: STORE_VERSION,
    settings: normalizeSettings({ ...seed, ...(migrated.settings ?? {}) }),
    providers,
    approvals,
    usage: {
      records,
      totals: records.reduce(
        (totals, record) => ({
          calls: totals.calls + 1,
          failed: totals.failed + (record.ok ? 0 : 1),
          promptTokens: totals.promptTokens + record.promptTokens,
          completionTokens: totals.completionTokens + record.completionTokens,
          costUsd: totals.costUsd + (record.costUsd ?? 0),
        }),
        { calls: 0, failed: 0, promptTokens: 0, completionTokens: 0, costUsd: 0 },
      ),
    },
  }
}

/**
 * The live store: one document per Host context, read once and written through.
 *
 * The panel and every tool go through this object so a settings change is
 * visible to the next call without a restart, and so two writers cannot
 * interleave a read-modify-write against the same file.
 */
export class Store {
  /**
   * @param ctx - host plugin context, used only to resolve the Harness home.
   * @param seed - the row's Config, seeding a document that does not exist yet.
   * @throws when the document exists but cannot be read, rather than seeding
   *         over it — the caller reports the path and leaves the bytes alone.
   */
  constructor(ctx, seed = {}) {
    this.path = storePath(ctx)
    this.seed = seed
    const read = readDocument(this.path)
    if (read.kind === 'unreadable') {
      const reason = read.error?.code ?? read.error?.message ?? 'unknown error'
      throw new Error(
        `cannot read ${this.path} (${reason}); refusing to start so an existing `
        + 'store is not overwritten with an empty one',
      )
    }
    if (read.kind === 'corrupt') quarantine(this.path)
    this.doc = normalizeStore(read.kind === 'ok' ? read.raw : null, seed)
    this.stamp = documentStamp(this.path)
    // A document that did not exist yet is written once, so the user can see and
    // back up a real file before they change anything.
    if (read.kind !== 'ok') this.flush()
  }

  /**
   * Re-read the document when it moved on disk.
   *
   * The store file is shared by every Harness process on the machine — the
   * desktop app and a `dsh web` session can both be open — and each one holds
   * the whole document in memory. Writing that memory back wholesale is how a
   * second process silently deletes the first one's providers, so every
   * mutation re-reads first and every read notices an outside write.
   *
   * @param force - re-read even when the stamp is unchanged (used before a write).
   * @returns the current document.
   */
  refresh(force = false) {
    const stamp = documentStamp(this.path)
    if (!force && stamp !== null && stamp === this.stamp) return this.doc
    const read = readDocument(this.path)
    if (read.kind === 'unreadable') {
      // Keep what is in memory and write nothing: a blind flush here is exactly
      // the overwrite this class exists to avoid.
      return this.doc
    }
    if (read.kind === 'corrupt') return this.doc
    this.doc = normalizeStore(read.kind === 'ok' ? read.raw : null, this.seed)
    this.stamp = documentStamp(this.path)
    return this.doc
  }

  /** Persist the document atomically. */
  flush() {
    const body = `${JSON.stringify(this.doc, null, 2)}\n`
    mkdirSync(dirname(this.path), { recursive: true })
    const temp = `${this.path}.${process.pid}.tmp`
    writeFileSync(temp, body, { encoding: 'utf8', mode: 0o600 })
    renameSync(temp, this.path)
    this.stamp = documentStamp(this.path)
    return this.doc
  }

  /** The current settings. */
  get settings() {
    this.refresh()
    return this.doc.settings
  }

  /** Replace settings with a validated merge; returns the new settings. */
  updateSettings(patch) {
    this.refresh(true)
    this.doc.settings = normalizeSettings({ ...this.doc.settings, ...patch })
    this.flush()
    return this.doc.settings
  }

  /** Every provider row, in insertion order. */
  get providers() {
    this.refresh()
    return this.doc.providers
  }

  /** One provider by id, or undefined. */
  provider(id) {
    this.refresh()
    return this.doc.providers.find((entry) => entry.id === id)
  }

  /**
   * Insert or replace one provider row.
   *
   * A replace keeps the row's position, so the panel's list does not reshuffle
   * under the user's cursor when a field is saved.
   */
  putProvider(raw) {
    this.refresh(true)
    const next = normalizeProvider({ ...raw, updatedAt: new Date().toISOString() })
    if (next === null) throw new Error('provider needs an id')
    const index = this.doc.providers.findIndex((entry) => entry.id === next.id)
    if (index === -1) {
      this.doc.providers.push({ ...next, createdAt: next.createdAt })
    } else {
      // A missing field in the patch keeps the stored value: the panel sends
      // whole rows, but the Host tools may patch one field.
      this.doc.providers[index] = { ...this.doc.providers[index], ...next }
    }
    this.flush()
    return this.provider(next.id)
  }

  /** Remove one provider row; returns whether a row was removed. */
  removeProvider(id) {
    this.refresh(true)
    const before = this.doc.providers.length
    this.doc.providers = this.doc.providers.filter((entry) => entry.id !== id)
    const removed = this.doc.providers.length !== before
    if (removed) this.flush()
    return removed
  }

  /** Append one usage record, trimming the ledger to its keep limit. */
  recordUsage(record) {
    this.refresh(true)
    const next = normalizeUsageRecord(record)
    if (next === null) return
    this.doc.usage.records.push(next)
    if (this.doc.usage.records.length > USAGE_KEEP) {
      this.doc.usage.records = this.doc.usage.records.slice(-USAGE_KEEP)
    }
    const totals = this.doc.usage.totals
    totals.calls += 1
    if (!next.ok) totals.failed += 1
    totals.promptTokens += next.promptTokens
    totals.completionTokens += next.completionTokens
    totals.costUsd += next.costUsd ?? 0
    this.flush()
  }

  /** Drop the ledger, keeping providers and settings. */
  resetUsage() {
    this.refresh(true)
    this.doc.usage = { records: [], totals: { calls: 0, failed: 0, promptTokens: 0, completionTokens: 0, costUsd: 0 } }
    this.flush()
    return this.doc.usage
  }

  /** Every approval row, oldest first. */
  get approvals() {
    this.refresh()
    return this.doc.approvals
  }

  /** Approvals still waiting for the user, newest first. */
  pendingApprovals() {
    this.refresh()
    return this.doc.approvals.filter((entry) => entry.status === 'pending').reverse()
  }

  /**
   * Record a call that needs the user's yes before it runs.
   *
   * @returns the stored approval, whose `id` the caller reports back so the
   *          request can be retried once the user decides.
   */
  addApproval(raw) {
    this.refresh(true)
    const next = normalizeApproval({ ...raw, status: 'pending', createdAt: new Date().toISOString() })
    if (next === null) throw new Error('approval needs an id')
    this.doc.approvals.push(next)
    if (this.doc.approvals.length > APPROVAL_KEEP) {
      this.doc.approvals = this.doc.approvals.slice(-APPROVAL_KEEP)
    }
    this.flush()
    return next
  }

  /** One approval by id. */
  approval(id) {
    this.refresh()
    return this.doc.approvals.find((entry) => entry.id === id)
  }

  /** The user's decision, recorded with its timestamp. */
  decideApproval(id, status) {
    this.refresh(true)
    const entry = this.doc.approvals.find((candidate) => candidate.id === id)
    if (entry === undefined) return undefined
    if (entry.status !== 'pending') return entry
    entry.status = status === 'approved' ? 'approved' : 'denied'
    entry.decidedAt = new Date().toISOString()
    this.flush()
    return entry
  }

  /**
   * Whether a grant authorizes this exact call right now.
   *
   * Checked on every retry rather than trusted from the caller's memory: the
   * digest must match the prompt about to be sent, and the grant must be
   * approved, unused and inside its lifetime.
   */
  approvalUsable(id, digest, now = Date.now()) {
    const entry = this.approval(id)
    if (entry === undefined) return false
    if (entry.status !== 'approved' || entry.consumedAt !== '') return false
    if (entry.digest !== digest) return false
    const decided = Date.parse(entry.decidedAt)
    if (!Number.isFinite(decided) || now - decided > APPROVAL_TTL_MS) return false
    return true
  }

  /** Mark a grant used, so one approval can never pay for two calls. */
  consumeApproval(id) {
    this.refresh(true)
    const entry = this.doc.approvals.find((candidate) => candidate.id === id)
    if (entry === undefined) return undefined
    entry.consumedAt = new Date().toISOString()
    this.flush()
    return entry
  }

  /** Cost booked today, in USD, from the ledger's own timestamps. */
  costToday(now = Date.now()) {
    this.refresh()
    const midnight = new Date(now)
    midnight.setHours(0, 0, 0, 0)
    const start = midnight.getTime()
    return this.doc.usage.records.reduce((sum, record) => {
      const at = Date.parse(record.at)
      return Number.isFinite(at) && at >= start ? sum + (record.costUsd ?? 0) : sum
    }, 0)
  }

  /** The document without secret bytes, for export and for the panel's state. */
  exportable() {
    this.refresh()
    return {
      version: this.doc.version,
      settings: this.doc.settings,
      providers: this.doc.providers.map((provider) => ({ ...provider, apiKey: '' })),
    }
  }

  /** Whether the document exists on disk yet (always true after construction). */
  exists() {
    return statSync(this.path, { throwIfNoEntry: false })?.isFile() === true
  }

  /** Delete the document; the next construction starts fresh. */
  destroy() {
    try {
      unlinkSync(this.path)
    } catch { /* an absent document is already the desired state */ }
  }
}
