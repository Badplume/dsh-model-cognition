/**
 * Host half of Model Cognition.
 *
 * Three registrations, each waited for declaratively rather than polled:
 * `tools` (the agent-facing way to consult another model), `skills` (the
 * guidance that tells an agent when to), and `webServer` (the settings panel's
 * transport). Each waits on its own service with `ctx.inject([...], …)`, which
 * covers both the boot-time chain and the hot-reload chain, and each callback
 * returns nothing — an inject callback that returns a value is rejected as an
 * invalid effect and takes the whole plugin down with it.
 *
 * Nothing here throws out of `apply`: a registration this plugin cannot make is
 * logged and skipped, because the Host answers a failed host fiber by dropping
 * the plugin's client bundle from the module graph as well, which would take the
 * settings page down with the tools.
 *
 * @module dsh-model-cognition
 */
import { PACKAGE_NAME } from './constants.js'
import { registerRoutes } from './routes.js'
import { registerSkills } from './skills.js'
import { Store } from './store.js'
import { buildTools } from './tools.js'

export const name = PACKAGE_NAME

/** Warn on the Host's log without ever throwing into the plugin loader. */
function warn(ctx, message) {
  try {
    ctx?.logger?.warn?.(`[${PACKAGE_NAME}] ${message}`)
  } catch {
    // A logger that itself fails must not be able to fail this plugin.
  }
}

/** Register one thing, reporting rather than throwing when the Host refuses. */
function guarded(ctx, label, register) {
  try {
    register()
  } catch (error) {
    warn(ctx, `${label} 注册失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * Plugin entry.
 *
 * @param ctx - the host plugin context.
 * @param config - the row's config from `cordis.patch.yml`; it only seeds a
 *                 store that does not exist yet, after which the store is the
 *                 single source of truth for both the panel and the tools.
 */
export function apply(ctx, config) {
  let store
  try {
    store = new Store(ctx, config ?? {})
  } catch (error) {
    warn(ctx, `无法打开数据文件，插件已停用：${error instanceof Error ? error.message : String(error)}`)
    return
  }

  ctx.inject(['tools'], (scope) => {
    for (const tool of buildTools(ctx, store)) {
      guarded(ctx, `工具 ${tool.name}`, () => {
        scope.effect(() => scope.tools.register(tool), `${PACKAGE_NAME}: tool ${tool.name}`)
      })
    }
  })

  ctx.inject(['skills'], (scope) => {
    guarded(ctx, '技能目录', () => registerSkills(ctx, scope, store))
  })

  ctx.inject(['webServer'], (scope) => {
    guarded(ctx, 'HTTP 接口', () => registerRoutes(ctx, scope, store))
  })
}
