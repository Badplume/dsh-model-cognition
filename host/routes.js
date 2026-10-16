/**
 * The panel's HTTP surface.
 *
 * The settings page is a client module, so every read and write it performs
 * travels over these routes. Nothing here is a second implementation of a rule
 * that already exists: settings writes call the same store method the tools
 * read, and a provider test calls the same adapter a real call would.
 *
 * All routes sit under one prefix and are registered as a single entry, so a
 * path collision with another plugin can only come from the prefix itself — and
 * a throw there is caught, because a failed fiber would take the client bundle
 * down with it.
 *
 * @module dsh-model-cognition/host/routes
 */
import { BODY_LIMIT, KEY_MODES, PROTOCOLS, PROVIDER_PRESETS, ROUTE_PREFIX, deriveProviderId, isValidProviderId } from './constants.js'
import { listModels } from './providers.js'
import { clearProviderKey, describeProviderKey, hasCredentialStore, readProviderKey, writeProviderKey } from './secrets.js'

/** Write one JSON response. */
function sendJson(res, status, payload) {
  const body = JSON.stringify(payload ?? null)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  })
  res.end(body)
}

/** Answer a request whose method this route does not accept. */
function methodRefused(res, allowed) {
  res.writeHead(405, { allow: allowed.join(', '), 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify({ error: `只接受 ${allowed.join('/')}` }))
}

/** Read a JSON body, or throw an Error carrying an HTTP status. */
async function readJson(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > BODY_LIMIT) {
      throw Object.assign(new Error('请求体过大'), { status: 413 })
    }
    chunks.push(chunk)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.trim() === '') return {}
  try {
    const parsed = JSON.parse(text)
    return parsed !== null && typeof parsed === 'object' ? parsed : {}
  } catch {
    throw Object.assign(new Error('请求体不是合法 JSON'), { status: 400 })
  }
}

/** A hostname that can only be this machine. */
function isLoopbackHost(host) {
  const name = String(host ?? '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '').toLowerCase()
  return name === 'localhost' || name === '::1' || /^127\./.test(name)
}

/**
 * Whether a request must be refused, and with which status.
 *
 * The Host's own fence is preferred: `connection.requestRejection` is the same
 * check the product's `/api` surface uses, including its browser-session cookie.
 * The fallback is deliberately narrower than that fence — it only accepts
 * same-origin requests addressed to a loopback host — so a host without the
 * connection service is still not writable from a page the user merely visited.
 */
function refusalOf(ctx, req) {
  const connection = ctx?.get?.('connection')
  if (connection !== undefined && typeof connection.requestRejection === 'function') {
    const rejected = connection.requestRejection(req)
    if (rejected !== undefined) return rejected
    return undefined
  }
  const host = req.headers.host
  if (host === undefined || String(host).trim() === '') return 403
  let hostname
  try {
    hostname = new URL(`http://${host}`).hostname
  } catch {
    return 403
  }
  if (!isLoopbackHost(hostname)) return 403
  const site = req.headers['sec-fetch-site']
  if (site !== undefined && site !== 'same-origin' && site !== 'none') return 403
  const origin = req.headers.origin
  if (origin !== undefined && origin !== 'null') {
    let originHost
    try {
      originHost = new URL(origin).host
    } catch {
      return 403
    }
    if (originHost !== host) return 403
  }
  return undefined
}

/** The provider row as the panel needs it: metadata, never the key itself. */
async function providerView(ctx, provider) {
  const key = await describeProviderKey(ctx, provider)
  return {
    id: provider.id,
    label: provider.label,
    protocol: provider.protocol,
    baseUrl: provider.baseUrl,
    keyMode: provider.keyMode,
    keyless: provider.keyless,
    keyConfigured: key.configured,
    keySource: key.source,
    keyWritable: key.writable !== false,
    enabled: provider.enabled !== false,
    models: provider.models,
    extraHeaders: provider.extraHeaders,
    maxTokensParam: provider.maxTokensParam,
    notes: provider.notes,
    createdAt: provider.createdAt,
    updatedAt: provider.updatedAt,
  }
}

/** Everything the panel renders in one round trip. */
async function stateOf(ctx, store) {
  const providers = []
  for (const provider of store.providers) providers.push(await providerView(ctx, provider))
  const usage = store.doc.usage
  return {
    settings: store.settings,
    providers,
    usage: {
      totals: usage.totals,
      todayUsd: store.costToday(),
      records: usage.records.slice(-50).reverse(),
    },
    approvals: store.pendingApprovals(),
    presets: PROVIDER_PRESETS,
    protocols: PROTOCOLS,
    keyModes: KEY_MODES,
    capabilities: {
      credentialStore: hasCredentialStore(ctx),
      storePath: store.path,
    },
  }
}

/** Apply one provider mutation, writing the key where the row says it lives. */
async function saveProvider(ctx, store, payload) {
  const raw = payload.provider
  if (raw === null || typeof raw !== 'object') {
    throw Object.assign(new Error('缺少 provider'), { status: 400 })
  }
  const existing = typeof raw.id === 'string' ? store.provider(raw.id) : undefined
  const id = typeof raw.id === 'string' && raw.id.trim() !== ''
    ? raw.id.trim()
    : deriveProviderId(raw.label ?? 'provider', store.providers.map((entry) => entry.id))
  if (!isValidProviderId(id)) {
    throw Object.assign(new Error(`供应商 id 不合法：${id}（小写字母开头，只能含小写字母、数字、连字符）`), { status: 400 })
  }
  const merged = {
    ...(existing ?? {}),
    ...raw,
    id,
  }
  // A brand-new provider the user did not give a key to must not inherit the
  // previous row's stored bytes through the spread above.
  if (existing === undefined) merged.apiKey = typeof raw.apiKey === 'string' ? raw.apiKey : ''
  const keyMode = KEY_MODES.includes(merged.keyMode) ? merged.keyMode : 'record'
  const incomingKey = typeof payload.apiKey === 'string' ? payload.apiKey.trim() : ''

  if (keyMode === 'inline') {
    if (incomingKey !== '') merged.apiKey = incomingKey
    const saved = store.putProvider({ ...merged, keyMode: 'inline' })
    return saved
  }
  // `record` (and the keyless case): the store keeps no bytes, and an incoming
  // key goes to the credential service instead.
  delete merged.apiKey
  const saved = store.putProvider({ ...merged, keyMode, apiKey: '' })
  if (incomingKey !== '') await writeProviderKey(ctx, id, incomingKey)
  return saved
}

/**
 * Build the request handler for this plugin's prefix.
 *
 * @param ctx - host plugin context.
 * @param store - the plugin store.
 * @returns an async `(req, res)` handler.
 */
export function createHandler(ctx, store) {
  return async function handle(req, res) {
    const refusal = refusalOf(ctx, req)
    if (refusal !== undefined) {
      sendJson(res, refusal, { error: '请求被拒绝' })
      return
    }
    let url
    try {
      url = new URL(req.url ?? '/', 'http://localhost')
    } catch {
      sendJson(res, 400, { error: '无法解析请求路径' })
      return
    }
    const rest = url.pathname.startsWith(ROUTE_PREFIX) ? url.pathname.slice(ROUTE_PREFIX.length) : url.pathname
    const segments = rest.split('/').filter((part) => part !== '')
    const method = (req.method ?? 'GET').toUpperCase()
    const head = segments[0] ?? ''

    try {
      if (head === 'state' && segments.length === 1) {
        if (method !== 'GET' && method !== 'HEAD') return methodRefused(res, ['GET', 'HEAD'])
        sendJson(res, 200, await stateOf(ctx, store))
        return
      }

      if (head === 'settings' && segments.length === 1) {
        if (method !== 'PUT' && method !== 'POST') return methodRefused(res, ['PUT', 'POST'])
        const body = await readJson(req)
        const settings = store.updateSettings(body.settings ?? body)
        sendJson(res, 200, { settings })
        return
      }

      if (head === 'usage' && segments[1] === 'reset') {
        if (method !== 'POST') return methodRefused(res, ['POST'])
        sendJson(res, 200, { usage: store.resetUsage() })
        return
      }

      if (head === 'providers' && segments.length === 1) {
        if (method === 'POST' || method === 'PUT') {
          const body = await readJson(req)
          const saved = await saveProvider(ctx, store, body)
          sendJson(res, 200, { provider: await providerView(ctx, saved) })
          return
        }
        return methodRefused(res, ['POST', 'PUT'])
      }

      if (head === 'providers' && segments.length >= 2) {
        const id = decodeURIComponent(segments[1])
        const provider = store.provider(id)
        if (provider === undefined) {
          sendJson(res, 404, { error: `没有供应商 ${id}` })
          return
        }
        if (segments.length === 2 && (method === 'DELETE')) {
          store.removeProvider(id)
          await clearProviderKey(ctx, id)
          sendJson(res, 200, { removed: id })
          return
        }
        if (segments[2] === 'key' && (method === 'PUT' || method === 'POST')) {
          const body = await readJson(req)
          await writeProviderKey(ctx, id, typeof body.apiKey === 'string' ? body.apiKey.trim() : '')
          sendJson(res, 200, { provider: await providerView(ctx, store.provider(id)) })
          return
        }
        if (segments[2] === 'test' && method === 'POST') {
          const body = await readJson(req)
          // A test may carry a not-yet-saved key, so the user can verify a key
          // before committing it to the credential store.
          const supplied = typeof body.apiKey === 'string' ? body.apiKey.trim() : ''
          const apiKey = supplied !== '' ? supplied : await readProviderKey(ctx, provider)
          try {
            const models = await listModels(ctx, {
              provider,
              apiKey,
              timeoutMs: Number(store.settings.timeoutMs),
            })
            sendJson(res, 200, { ok: true, models, count: models.length })
          } catch (error) {
            sendJson(res, 200, {
              ok: false,
              error: error instanceof Error ? error.message : String(error),
              code: error?.code ?? 'error',
            })
          }
          return
        }
        sendJson(res, 404, { error: '未知操作' })
        return
      }

      if (head === 'approvals' && segments.length >= 2) {
        const id = decodeURIComponent(segments[1])
        if (method !== 'POST') return methodRefused(res, ['POST'])
        const body = await readJson(req)
        const decision = body.decision === 'approve' ? 'approved' : body.decision === 'deny' ? 'denied' : ''
        if (decision === '') {
          sendJson(res, 400, { error: 'decision 必须是 approve 或 deny' })
          return
        }
        const entry = store.decideApproval(id, decision)
        if (entry === undefined) {
          sendJson(res, 404, { error: `没有待批准项 ${id}` })
          return
        }
        sendJson(res, 200, { approval: entry })
        return
      }

      if (head === 'test' && segments.length === 1) {
        if (method !== 'POST') return methodRefused(res, ['POST'])
        const body = await readJson(req)
        // The panel tests a provider that has not been saved yet, so the row
        // arrives in the body. The key may be the one being typed (never stored)
        // or the one already configured for that id.
        const draft = body.provider
        if (draft === null || typeof draft !== 'object') {
          sendJson(res, 400, { error: '缺少 provider' })
          return
        }
        // Refuse an unknown protocol instead of quietly testing something else:
        // a silent fallback would surface as a confusing vendor error.
        if (draft.protocol !== undefined && !PROTOCOLS.includes(draft.protocol)) {
          sendJson(res, 400, { error: `不支持的协议 ${draft.protocol}` })
          return
        }
        if (draft.keyMode !== undefined && !KEY_MODES.includes(draft.keyMode)) {
          sendJson(res, 400, { error: `不支持的密钥模式 ${draft.keyMode}` })
          return
        }
        const candidate = {
          id: typeof draft.id === 'string' && draft.id !== '' ? draft.id : 'draft',
          label: draft.label ?? 'draft',
          protocol: PROTOCOLS.includes(draft.protocol) ? draft.protocol : 'openai',
          baseUrl: draft.baseUrl ?? '',
          keyless: draft.keyless === true,
          keyMode: KEY_MODES.includes(draft.keyMode) ? draft.keyMode : 'record',
          apiKey: typeof draft.apiKey === 'string' ? draft.apiKey : '',
          extraHeaders: draft.extraHeaders ?? {},
        }
        // The key may arrive beside the row (`apiKey`) or inside it; the panel
        // sends it beside, and accepting both keeps the route usable by hand.
        const supplied = typeof body.apiKey === 'string' ? body.apiKey.trim() : ''
        let apiKey = supplied === '' ? candidate.apiKey : supplied
        if (apiKey === '' && !candidate.keyless && candidate.id !== 'draft') {
          apiKey = await readProviderKey(ctx, store.provider(candidate.id) ?? candidate)
        }
        try {
          const models = await listModels(ctx, { provider: candidate, apiKey, timeoutMs: Number(store.settings.timeoutMs) })
          sendJson(res, 200, { ok: true, models, count: models.length })
        } catch (error) {
          sendJson(res, 200, {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
            code: error?.code ?? 'error',
          })
        }
        return
      }

      if (head === 'export' && segments.length === 1) {
        if (method !== 'GET') return methodRefused(res, ['GET'])
        sendJson(res, 200, store.exportable())
        return
      }

      sendJson(res, 404, { error: '未知接口' })
    } catch (error) {
      const status = Number(error?.status) || 500
      sendJson(res, status, { error: error instanceof Error ? error.message : String(error) })
    }
  }
}

/**
 * Register the prefix route on the Harness web server.
 *
 * The registration is wrapped because two plugins claiming one prefix make
 * `register` throw, and an exception thrown out of `apply` fails this bundle's
 * fiber — which the Host answers by dropping the plugin's client bundle too.
 *
 * @returns whether the route was registered.
 */
export function registerRoutes(ctx, scope, store) {
  const webServer = scope?.webServer ?? ctx?.get?.('webServer')
  if (webServer === undefined || webServer === null || typeof webServer.register !== 'function') return false
  const handler = createHandler(ctx, store)
  const route = { kind: 'prefix', path: ROUTE_PREFIX, handler }
  try {
    const dispose = webServer.register(route)
    if (typeof dispose === 'function' && typeof scope?.effect === 'function') {
      scope.effect(() => dispose, 'model-cognition: http routes')
    }
    return true
  } catch (error) {
    ctx?.logger?.warn?.(`[model-cognition] 路由注册失败：${error instanceof Error ? error.message : error}`)
    return false
  }
}
