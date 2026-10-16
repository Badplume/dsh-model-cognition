/**
 * Validate this plugin's tool definitions against the REAL DSH runtime.
 *
 * The DSH tool registry enforces a JSON Schema subset on every schema a
 * definition carries (`checkSchemaNode` in `@deepseek-ai/dsh-tools`), and a
 * plugin that violates it loses the tool silently — the model simply never
 * sees it. Reading that checker is not the same as running it, so when a DSH
 * installation is reachable this test imports the genuine module and runs the
 * genuine `assertSupportedJsonSchema` over every schema this plugin ships.
 *
 * Point `DSH_TOOLS_ENTRY` at
 * `<dsh tree>/node_modules/@deepseek-ai/dsh-tools/lib/index.js` to enable it
 * (a plain directory where the DSH npm tree is unpacked; the module cannot be
 * imported straight out of an asar archive). Without it the test SKIPS with a
 * success exit code, so `npm test` stays dependency-free for everyone else —
 * `self-test.mjs` still covers the shape independently.
 */

import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { Store } from '../host/store.js'
import { buildTools } from '../host/tools.js'

const HERE = new URL('.', import.meta.url)
const DEFAULT_ENTRY = resolve(fileURLToPath(HERE), '../node_modules/@deepseek-ai/dsh-tools/lib/index.js')
const ENTRY = process.env.DSH_TOOLS_ENTRY ?? DEFAULT_ENTRY

let runtime = null
if (existsSync(ENTRY)) {
  try {
    runtime = await import(pathToFileURL(ENTRY).href)
  } catch (error) {
    runtime = null
    process.stdout.write(`runtime-contract: cannot load ${ENTRY}: ${error.message}\n`)
  }
}

if (runtime === null) {
  process.stdout.write(
    'runtime-contract: SKIP — no DSH tool runtime at\n'
    + `  ${ENTRY}\n`
    + '  set DSH_TOOLS_ENTRY to <dsh tree>/node_modules/@deepseek-ai/dsh-tools/lib/index.js\n',
  )
  process.exit(0)
}

const { assertSupportedJsonSchema, validateJsonSchemaValue } = runtime
if (typeof assertSupportedJsonSchema !== 'function' || typeof validateJsonSchemaValue !== 'function') {
  process.stdout.write('runtime-contract: SKIP — the runtime does not export the schema checkers\n')
  process.exit(0)
}

let passed = 0
const failures = []

function check(label, fn) {
  try {
    fn()
    passed += 1
  } catch (error) {
    failures.push(`${label}: ${error.message}`)
  }
}

/** Representative arguments for each tool, as a model would send them. */
const SAMPLES = {
  model_list: {},
  model_ask: { model: 'mock/mock-large', prompt: '用一句话说明什么是幂等。' },
  model_ask_minimal: { prompt: '用一句话说明什么是幂等。' },
  model_panel: { models: ['mock/mock-large', 'mock/mock-small'], prompt: '这段代码有什么问题？' },
  model_usage: { limit: 5, onlyFailures: true },
}

const home = mkdtempSync(join(tmpdir(), 'mc-contract-'))
const ctx = { logger: { warn() {} }, get: () => undefined }
const store = new Store(ctx, {})

try {
  const tools = buildTools(ctx, store)
  check('the plugin still registers four tools', () => {
    if (tools.length !== 4) throw new Error(`expected 4 tools, got ${tools.length}`)
  })

  for (const tool of tools) {
    check(`${tool.name}: name is set and not reserved`, () => {
      if (typeof tool.name !== 'string' || tool.name === '') throw new Error('missing name')
      if (tool.name === 'run_code') throw new Error('run_code is reserved')
    })
    check(`${tool.name}: output is { schema, render }`, () => {
      if (tool.output === null || typeof tool.output !== 'object') throw new Error('output must be an object')
      if (typeof tool.output.render !== 'function') throw new Error('output.render must be a function')
    })
    check(`${tool.name}: output.schema passes the runtime subset`, () => {
      assertSupportedJsonSchema(tool.output.schema)
    })
    check(`${tool.name}: parameters passes the runtime subset`, () => {
      assertSupportedJsonSchema(tool.parameters)
    })
    check(`${tool.name}: parameters is an object schema`, () => {
      if (tool.parameters.type !== 'object') throw new Error('parameters.type must be "object"')
      const properties = tool.parameters.properties
      if (properties === null || typeof properties !== 'object') {
        throw new Error('parameters.properties must be an object')
      }
      for (const [key, value] of Object.entries(properties)) {
        // The pre-fix shape used a per-property `required` flag; JSON Schema
        // carries required-ness on the parent as an array of names.
        if (Object.hasOwn(value, 'required')) {
          throw new Error(`parameters.properties.${key}.required is not a JSON Schema keyword here`)
        }
      }
      for (const name of tool.parameters.required ?? []) {
        if (!Object.hasOwn(properties, name)) {
          throw new Error(`parameters.required names "${name}", which has no property`)
        }
      }
    })
    check(`${tool.name}: timeoutMs is a positive finite number`, () => {
      if (tool.timeoutMs === undefined) return
      if (!Number.isFinite(tool.timeoutMs) || tool.timeoutMs <= 0) {
        throw new Error(`timeoutMs must be positive and finite, got ${String(tool.timeoutMs)}`)
      }
    })
  }

  const ask = tools.find((tool) => tool.name === 'model_ask')
  check('model_ask: sample arguments satisfy its own schema', () => {
    const violations = validateJsonSchemaValue(ask.parameters, SAMPLES.model_ask, '')
    if (violations.length > 0) throw new Error(violations.join('; '))
  })
  check('model_ask: prompt alone is enough (model falls back to the setting)', () => {
    const violations = validateJsonSchemaValue(ask.parameters, SAMPLES.model_ask_minimal, '')
    if (violations.length > 0) throw new Error(violations.join('; '))
  })
  check('model_ask: an unknown argument is rejected', () => {
    const violations = validateJsonSchemaValue(ask.parameters, { prompt: 'hi', nonsense: 1 }, '')
    if (violations.length === 0) throw new Error('additionalProperties: false should reject unknown keys')
  })
  check('model_ask: a wrong argument type is rejected', () => {
    const violations = validateJsonSchemaValue(ask.parameters, { prompt: 42 }, '')
    if (violations.length === 0) throw new Error('a numeric prompt should be rejected')
  })

  const panel = tools.find((tool) => tool.name === 'model_panel')
  check('model_panel: sample arguments satisfy its own schema', () => {
    const violations = validateJsonSchemaValue(panel.parameters, SAMPLES.model_panel, '')
    if (violations.length > 0) throw new Error(violations.join('; '))
  })

  const usage = tools.find((tool) => tool.name === 'model_usage')
  check('model_usage: sample arguments satisfy its own schema', () => {
    const violations = validateJsonSchemaValue(usage.parameters, SAMPLES.model_usage, '')
    if (violations.length > 0) throw new Error(violations.join('; '))
  })
} finally {
  store.destroy()
  rmSync(home, { recursive: true, force: true })
}

for (const failure of failures) process.stdout.write(`  FAIL ${failure}\n`)
process.stdout.write(`runtime-contract: ${passed} passed, ${failures.length} failed\n`)
process.exit(failures.length === 0 ? 0 : 1)
