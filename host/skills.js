/**
 * The skills this plugin contributes.
 *
 * A skill is instructions for the agent, not code: whether to consult another
 * model, how to frame the question, and what to do when the budget guard asks
 * the user first. Shipping them from the plugin means the guidance arrives with
 * the tools it describes and cannot drift out of sync with a separately
 * installed copy.
 *
 * The provider reads its own `skills/` directory instead of holding a hard-coded
 * list, so a skill's `description` — the line the catalog shows — is the one in
 * its frontmatter, and adding a skill is adding a file.
 *
 * The rank is the registry's own constant for a packaged provider (600): a
 * project-local skill of the same name still wins, which is what a user who
 * copies one to edit it expects.
 *
 * @module dsh-model-cognition/host/skills
 */
import { readFile, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The registry's precedence rank for packaged skill providers. */
const PACKAGED_SKILL_RANK = 600

/** This provider's name; `runtime` is reserved by the registry. */
const PROVIDER_NAME = 'model-cognition'

/** Absolute path of the directory holding this plugin's skills. */
const SKILLS_DIR = fileURLToPath(new URL('../skills/', import.meta.url))

/** The kebab-case grammar the registry enforces on skill names. */
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * Read one frontmatter value.
 *
 * The subset used by skill files is a flat `key: value` map, so this handles
 * quoted and bare scalars without pulling in a YAML parser the profile may not
 * have next to the plugin.
 */
function scalar(text, key) {
  const match = new RegExp(`^${key}:[ \\t]*(.*)$`, 'm').exec(text)
  if (match === null) return undefined
  let value = match[1].trim()
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1)
  }
  return value
}

/** Parse a SKILL.md into the fields the registry validates. */
function parseSkill(body, fallbackName) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(body)
  const front = match === null ? '' : match[1]
  const name = scalar(front, 'name') ?? fallbackName
  const description = scalar(front, 'description') ?? ''
  const disabled = (scalar(front, 'disable-model-invocation') ?? 'false').toLowerCase() === 'true'
  return { name, description, disableModelInvocation: disabled }
}

/**
 * Build the provider object the registry borrows.
 *
 * `get()` re-reads the file every time — definitions are never cached by the
 * registry, and a user editing a skill's body expects their next question to use
 * the edited text.
 */
function buildProvider() {
  /** Every skill directory holding a SKILL.md, discovered once per list(). */
  async function discover() {
    let entries
    try {
      entries = await readdir(SKILLS_DIR, { withFileTypes: true })
    } catch {
      return []
    }
    const found = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const file = join(SKILLS_DIR, entry.name, 'SKILL.md')
      let body
      try {
        body = await readFile(file, 'utf8')
      } catch {
        continue
      }
      const meta = parseSkill(body, entry.name)
      if (!SKILL_NAME.test(meta.name)) continue
      found.push({
        name: meta.name,
        description: meta.description,
        invocation: { modelInvocable: !meta.disableModelInvocation, userInvocable: true },
        provider: PROVIDER_NAME,
        source: 'bundled',
        resourceBase: { kind: 'directory', path: dirname(file) },
        rank: PACKAGED_SKILL_RANK,
        locator: file,
      })
    }
    found.sort((left, right) => left.name.localeCompare(right.name))
    return found
  }

  return {
    name: PROVIDER_NAME,
    async list() {
      return discover()
    },
    async get(candidate) {
      // Load from the candidate's own locator rather than re-deriving it, so a
      // definition always matches the candidate the registry selected.
      const body = await readFile(candidate.locator, 'utf8')
      const meta = parseSkill(body, candidate.name)
      return {
        name: meta.name,
        description: meta.description === '' ? candidate.description : meta.description,
        invocation: { modelInvocable: !meta.disableModelInvocation, userInvocable: true },
        provider: PROVIDER_NAME,
        source: 'bundled',
        resourceBase: candidate.resourceBase,
        content: body,
      }
    },
  }
}

/**
 * Register this plugin's skill provider.
 *
 * @param ctx - host plugin context, for the warning channel only.
 * @param scope - the context whose `skills` service is live.
 * @returns whether the provider was registered.
 */
export function registerSkills(ctx, scope, _store) {
  const skills = scope?.skills ?? ctx?.get?.('skills')
  if (skills === undefined || skills === null || typeof skills.registerProvider !== 'function') return false
  try {
    const dispose = skills.registerProvider(() => buildProvider())
    if (typeof dispose === 'function' && typeof scope?.effect === 'function') {
      scope.effect(() => dispose, 'model-cognition: skill provider')
    }
    return true
  } catch (error) {
    ctx?.logger?.warn?.(`[model-cognition] 技能注册失败：${error instanceof Error ? error.message : error}`)
    return false
  }
}

export { SKILLS_DIR }
