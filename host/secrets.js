/**
 * Provider keys: where they are kept, and how they are read back.
 *
 * The product's rule is that a secret lives in the credential store and
 * configuration only ever names it. This plugin follows that rule by default:
 * a provider row carries no key bytes, and the key is a *record* keyed
 * `dsh-model-cognition/<providerId>` — the per-plugin half of the credential
 * key space, which keeps third-party keys out of the user-facing reference
 * namespace.
 *
 * Two exceptions exist on purpose. A host without the credential service (a
 * minimal headless profile) would otherwise have nowhere to put a key, and a
 * throwaway endpoint the user does not want in the shared key store is a real
 * request. Both are served by the row's `inline` mode, which keeps the value in
 * this plugin's own store file. The panel says plainly which mode a row uses.
 *
 * @module dsh-model-cognition/host/secrets
 */
import { PACKAGE_NAME } from './constants.js'

/**
 * The credential record key for one provider.
 *
 * Both segments satisfy the credential-key grammar (`^[a-z][a-z0-9-]*$`), which
 * `isValidProviderId` enforces before a row is ever stored, so the joined string
 * is always a valid key.
 */
export function providerKeyRef(providerId) {
  return `${PACKAGE_NAME}/${providerId}`
}

/** The credential service, when this host has one. */
function service(ctx) {
  const credentials = ctx?.get?.('credentials')
  return credentials !== undefined && credentials !== null ? credentials : undefined
}

/**
 * The value inside a record this plugin owns.
 *
 * The record shape is not ours to invent. The local credential provider admits
 * exactly two tags, and an `api-key` record may carry only `kind`, `key` and
 * `env` — the secret *is* the `key` field. A record with any other field is
 * refused when the document is next parsed, which fails the required
 * `credentials` plugin and stops the whole host from starting, so a wrong shape
 * here is not a cosmetic bug.
 *
 * @see dsh-credentials-local/lib/index.js — `parseRecord`, which rejects an
 *      unknown field, and `modifyRecord`, which does *not* check the field set
 *      on the way in: a bad record is written happily and only explodes at the
 *      next boot. `test/self-test.mjs` mirrors the parser so we cannot repeat it.
 */
function recordValue(record) {
  if (record === undefined || record === null) return undefined
  if (record.kind !== undefined && record.kind !== 'api-key') return undefined
  const value = record.key ?? record.payload?.value
  return typeof value === 'string' && value !== '' ? value : undefined
}

/**
 * Read one provider's key, from wherever the row says it lives.
 *
 * @param ctx - host plugin context.
 * @param provider - a normalized provider row.
 * @returns the key, or undefined when none is configured (a keyless endpoint
 *          legitimately returns undefined).
 */
export async function readProviderKey(ctx, provider) {
  if (provider === undefined || provider === null) return undefined
  if (provider.keyless || provider.keyMode === 'none') return undefined
  if (provider.keyMode === 'inline') {
    return provider.apiKey !== '' ? provider.apiKey : undefined
  }
  const credentials = service(ctx)
  if (credentials === undefined || typeof credentials.readRecord !== 'function') {
    // No credential service: an inline value is the only thing left to try, and
    // returning undefined here surfaces as a clear "no key configured" error
    // rather than a mysterious 401.
    return provider.apiKey !== '' ? provider.apiKey : undefined
  }
  const record = await credentials.readRecord(providerKeyRef(provider.id))
  return recordValue(record)
}

/**
 * Store one provider's key.
 *
 * @param ctx - host plugin context.
 * @param providerId - the provider the key belongs to.
 * @param value - the key; an empty string clears it.
 * @returns `{ mode }` naming where the key landed, for the panel to report.
 */
export async function writeProviderKey(ctx, providerId, value) {
  const credentials = service(ctx)
  if (credentials === undefined || typeof credentials.modifyRecord !== 'function') {
    return { mode: 'inline' }
  }
  const key = providerKeyRef(providerId)
  if (typeof value !== 'string' || value === '') {
    await credentials.deleteRecord(key)
    return { mode: 'record' }
  }
  await credentials.modifyRecord(key, async () => ({ kind: 'api-key', key: value }))
  return { mode: 'record' }
}

/** Remove one provider's key from the credential store. */
export async function clearProviderKey(ctx, providerId) {
  const credentials = service(ctx)
  if (credentials === undefined || typeof credentials.deleteRecord !== 'function') return false
  await credentials.deleteRecord(providerKeyRef(providerId))
  return true
}

/**
 * Describe a provider's key without revealing it.
 *
 * @returns `{ configured, mode, source }` where `source` is `'store'` for the
 *          credential record, `'inline'` for this plugin's own file, or `'none'`.
 */
export async function describeProviderKey(ctx, provider) {
  if (provider.keyless) return { configured: true, mode: 'none', source: 'keyless' }
  if (provider.keyMode === 'none') return { configured: true, mode: 'none', source: 'none' }
  if (provider.keyMode === 'inline') {
    return { configured: provider.apiKey !== '', mode: 'inline', source: 'inline' }
  }
  const credentials = service(ctx)
  if (credentials === undefined || typeof credentials.describeRecord !== 'function') {
    return { configured: provider.apiKey !== '', mode: 'inline', source: 'inline' }
  }
  const described = await credentials.describeRecord(providerKeyRef(provider.id))
  return {
    configured: described?.configured === true,
    // `writable` false means the backing store is read-only (for example a
    // container env file); the panel disables the field instead of failing a save.
    writable: described?.writable !== false,
    mode: 'record',
    source: 'store',
  }
}

/** Whether this host can keep keys in the credential store. */
export function hasCredentialStore(ctx) {
  const credentials = service(ctx)
  return credentials !== undefined
    && typeof credentials.modifyRecord === 'function'
    && typeof credentials.readRecord === 'function'
}
