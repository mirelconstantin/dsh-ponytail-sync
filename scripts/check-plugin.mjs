/**
 * The plugin contract, asserted against a fake Cordis context.
 *
 * This is a regression guard, not a unit test suite: it proves the things a
 * harness does at LOAD time that a hand-mounted test would silently skip. The
 * most important is that the module has **no default export** — the loader
 * unwraps `.default` in preference to the namespace, which silently drops
 * `inject`, `name` and `Config` and leaves every dependent row PENDING forever.
 * Mounting the plugin by hand never exercises that path.
 *
 * It also pins the load-bearing upstream rules, so a vendored skill body that
 * has drifted past the point where it still teaches ponytail fails here rather
 * than in a session. That is the local equivalent of upstream's
 * `scripts/check-rule-copies.js`.
 *
 * Run with `node scripts/check-plugin.mjs`.
 *
 * @module dsh-ponytail-sync/check-plugin
 */

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { readFile, writeFile, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

import * as plugin from '../src/index.js'
import { CONFIG_DEFAULTS, CONFIG_TYPES, LEVELS, configValidator, isLevel, normalizeLevel, resolveConfig } from '../src/config.js'
import { LEVEL_COMMAND, ONESHOT_NAMES, helpCard, instructionMessage, oneshotInstructions, parseLevelArgument, registerPonytailCommands } from '../src/commands.js'
import { buildSection, ponytailSkillVisible } from '../src/prompt.js'
import { SKILL_DESCRIPTION, skillBodyPath } from '../src/skills.js'
import { SERVICE, PonytailRuntime, clearLevel, isActive, levelOf, renderSection, setLevel } from '../src/runtime.js'
import { checkIcon, externalModuleNames, localModuleNames } from './check-patch.mjs'
import { REQUIRED_FILES, missingFromPack, readPackManifest } from './check-pack.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')

/**
 * Build a fake Cordis context that behaves like the harness for the parts this
 * plugin touches.
 *
 * @param {object} [options] - what the fake should expose.
 * @returns {any} the fake context.
 */
function fakeCtx (options = {}) {
  const registered = []
  const sections = []
  const provided = new Map()
  const effects = []
  const disposers = []
  const logCalls = []
  const skills = []

  const ctx = {
    registered,
    sections,
    provided,
    effects,
    logCalls,
    skills,
    get (key) {
      if (key === 'skills') return options.noSkills ? undefined : fakeSkills
      if (key === 'commands') return options.noCommands ? undefined : fakeCommands
      return provided.get(key)
    },
    provide (key, value) {
      provided.set(key, value)
      return () => provided.delete(key)
    },
    effect (fn, label) {
      effects.push({ fn, label })
      const result = fn()
      if (result && typeof result.then === 'function') return result
      if (typeof result === 'function') disposers.push(result)
      return result
    },
    disposeAll () {
      for (const dispose of disposers.reverse()) dispose()
    },
    logger (label) {
      return { info: (message) => logCalls.push({ label, message }) }
    },
    systemPrompt: {
      getSectionOrder (name) {
        if (name !== 'TOOL_WEB_FETCH') throw new Error(`unknown section ${name}`)
        return 2100
      },
      section (definition) { sections.push(definition); return () => {} },
    },
  }

  const fakeSkills = options.noSkills ? undefined : {
    registered: skills,
    register (skill) {
      skills.push(skill)
      return () => {
        const at = skills.indexOf(skill)
        if (at !== -1) skills.splice(at, 1)
      }
    },
    // The documented visibility resolver. `restrictedScope` is the agent a
    // preset narrowed; a restricted-away name reads as absent for that agent
    // only, which is what the visibility check must survive. The harness passes
    // the agent as the scope key, so the fake compares by identity.
    get (name, scope) {
      if (options.restrictedScope !== undefined && scope === options.restrictedScope) return undefined
      return skills.find((skill) => skill.name === name)
    },
  }

  const fakeCommands = options.noCommands ? undefined : {
    register (definition) { registered.push(definition); return () => {} },
  }

  return ctx
}

/**
 * Run one assertion, naming the rule it protects.
 *
 * The body runs exactly once. Testing `instanceof Promise` by calling the body
 * a second time would execute every assertion twice, which for the ones that
 * mutate the session-level map or register skills means the second run sees the
 * first run's leftovers.
 *
 * @param {string} label - the rule.
 * @param {() => any} body - the assertion.
 * @returns {Promise<void> | void} settled when the promise resolves, else nothing.
 */
function check (label, body) {
  const result = body()
  if (result instanceof Promise) {
    return result.then(
      () => { process.stdout.write(`  ok  ${label}\n`) },
      (error) => { throw new Error(`${label}\n${error?.stack ?? error}`) },
    )
  }
  process.stdout.write(`  ok  ${label}\n`)
}

// ---------------------------------------------------------------------------
// §1 The loader contract.
// ---------------------------------------------------------------------------

check('the module has no default export (the loader would drop inject/name/Config)', () => {
  assert.equal('default' in plugin, false, 'a default export silently strips the plugin metadata')
})

check('the plugin declares its identity, service and empty inject', () => {
  // The package name and the loader identity are the same string. The package is
  // `dsh-ponytail-sync` because `dsh-ponytail` is taken on the registry by
  // another author, and the identity was renamed to match rather than left behind:
  // a profile that installed the old name has to be reinstalled either way.
  assert.equal(plugin.name, 'dsh-ponytail-sync')
  assert.equal(plugin.name, manifest().name, 'the loader identity and the package name must not drift apart')
  assert.equal(plugin.SERVICE, 'ponytail')
  assert.deepEqual(plugin.inject, [], 'inject must not gate the surface on an optional seam')
})

check('apply publishes the service and returns undefined', () => {
  const ctx = fakeCtx()
  const result = plugin.apply(ctx, {})
  assert.equal(result, undefined, 'a returned runtime object fails the load with "Invalid effect"')
  assert.equal(ctx.provided.has('ponytail'), true, 'the service must be published')
  assert.ok(ctx.logCalls.some((entry) => entry.message.includes('default level')), 'the load must log the resolved level')
})

check('the service publication is an effect with a label', () => {
  const ctx = fakeCtx()
  plugin.apply(ctx, {})
  const labels = ctx.effects.map((entry) => entry.label)
  assert.ok(labels.includes('ctx.provide(ponytail)'), 'provide must be an effect so unload is clean')
})

check('apply survives a context with no logger', () => {
  const ctx = fakeCtx()
  ctx.logger = undefined
  assert.doesNotThrow(() => plugin.apply(ctx, {}), 'a missing logger must not fail the load')
})

// ---------------------------------------------------------------------------
// §2 Configuration.
// ---------------------------------------------------------------------------

check('Config validates defaults and rejects an unknown key', () => {
  const schema = plugin.Config
  const validate = schema['~standard']?.validate ?? schema.validate
  assert.equal(typeof validate, 'function', 'Config must expose a Standard Schema validator')
  assert.ok(validate({}).value, 'an empty config must resolve')
  const typo = validate({ defaultLevelTypo: 'x' })
  assert.ok(typo.issues?.length === 1, `an unknown key must be rejected, got ${JSON.stringify(typo)}`)
})

check('Config rejects a level outside the closed set', () => {
  const validate = plugin.Config['~standard'].validate
  assert.ok(validate({ defaultLevel: 'ludicrous' }).issues?.length === 1, 'an unknown level must be rejected')
  for (const level of LEVELS) {
    assert.ok(!validate({ defaultLevel: level }).issues, `"${level}" must be a legal default`)
  }
})

check('resolveConfig normalises a level and clamps the section budget', () => {
  const value = resolveConfig({ defaultLevel: ' ULTRA ', maxSectionChars: 1 })
  assert.equal(value.defaultLevel, 'ultra', 'whitespace and case must not defeat the level')
  assert.equal(value.maxSectionChars, 1000, 'a budget below the floor is clamped, not rejected')
  assert.equal(value.promptEnabled, true, 'promptEnabled defaults on')
})

check('isLevel and normalizeLevel agree on every legal value and reject the rest', () => {
  for (const level of LEVELS) {
    assert.equal(isLevel(level), true, `${level} is a level`)
    assert.equal(normalizeLevel(level), level, `${level} survives normalisation`)
  }
  assert.equal(isLevel('review'), false, 'review is a session-only upstream mode, never a default')
  assert.equal(normalizeLevel('nonsense', 'lite'), 'lite', 'an unknown value falls back')
})

check('every config default is in config.js, and the patch file declares no undeclared key', async () => {
  const text = await readFile(join(ROOT, 'cordis.patch.yml'), 'utf8')
  const block = text.slice(text.indexOf('config:'))
  const declared = [...block.matchAll(/^ {8}([A-Za-z][A-Za-z0-9]*):/gm)].map((m) => m[1])
  for (const key of declared) {
    assert.ok(key in CONFIG_DEFAULTS, `cordis.patch.yml declares "${key}", which CONFIG_DEFAULTS does not have`)
    assert.ok(key in CONFIG_TYPES, `cordis.patch.yml declares "${key}" with no declared type`)
  }
  for (const key of Object.keys(CONFIG_DEFAULTS)) {
    assert.ok(CONFIG_TYPES[key] !== undefined, `CONFIG_DEFAULTS key "${key}" has no type`)
  }
})

// ---------------------------------------------------------------------------
// §3 The runtime and the level.
// ---------------------------------------------------------------------------

check('the level is per session, so two sessions never see each other\'s choice', () => {
  const runtime = PonytailRuntime({ ctx: fakeCtx(), config: resolveConfig({}), log: () => {} })
  clearLevel()
  assert.equal(levelOf(runtime, 'session-a'), 'full', 'a new session uses the default')
  setLevel('session-a', 'ultra')
  assert.equal(levelOf(runtime, 'session-a'), 'ultra', 'the changed session sees its own level')
  assert.equal(levelOf(runtime, 'session-b'), 'full', 'another session is untouched')
  assert.equal(runtime.levelFor('session-a'), 'ultra', 'the runtime reads the same map')
  clearLevel('session-a')
  assert.equal(levelOf(runtime, 'session-a'), 'full', 'a cleared session returns to the default')
  clearLevel()
})

check('the default level is read per call, so a settings change applies to the next session', () => {
  const before = PonytailRuntime({ ctx: fakeCtx(), config: resolveConfig({ defaultLevel: 'lite' }), log: () => {} })
  assert.equal(levelOf(before, 's'), 'lite', 'the mounted default is honoured')
  const after = PonytailRuntime({ ctx: fakeCtx(), config: resolveConfig({ defaultLevel: 'off' }), log: () => {} })
  assert.equal(levelOf(after, 's'), 'off', 'a new mount sees the new default without a restart')
  clearLevel('s')
})

check('an off level renders an empty section rather than a section that says it is off', () => {
  assert.equal(renderSection('off'), '', 'off must publish nothing')
  for (const level of ['lite', 'full', 'ultra']) {
    assert.ok(renderSection(level).length > 40, `${level} must render a usable section`)
  }
})

check('every non-off section states the level and the closing rule', () => {
  for (const level of ['lite', 'full', 'ultra']) {
    const text = renderSection(level)
    assert.ok(text.includes(level), `${level} section names the level`)
    assert.ok(text.includes('what you skipped or did not check'), `${level} section carries the closing rule`)
    assert.ok(text.includes('skill'), `${level} section points at the skill`)
  }
})

check('a rendered section fits inside the floor of its configured budget', () => {
  // The section is repeated on every request, so the budget floor must be above
  // the rendered length or a user at the floor gets a silently truncated prompt.
  const config = resolveConfig({ maxSectionChars: 1 })
  for (const level of ['lite', 'full', 'ultra']) {
    assert.ok(renderSection(level).length <= config.maxSectionChars,
      `${level} renders ${renderSection(level).length} characters, above the ${config.maxSectionChars} floor`)
  }
})

check('the configured budget is applied to the rendered section, and the notice says so', () => {
  // The section is about 465 characters, and `resolveConfig` floors the budget at
  // 1000, so a real deployment never truncates at all. The floor exists so a
  // user cannot configure a budget the section cannot fit into; the truncation
  // path below it is reachable only by calling the renderer directly, which is
  // what these cases cover.
  const floored = resolveConfig({ maxSectionChars: 100 })
  assert.equal(floored.maxSectionChars, 1000, 'a budget below the floor is clamped up, not honoured')
  assert.ok(renderSection('full', floored.maxSectionChars).length < 1000, 'the default floor is not a truncation')

  const text = renderSection('full', 300)
  assert.equal(text.length, 300, 'the section is cut to exactly its budget')
  assert.ok(text.includes('truncated'), 'a cut section says it was cut')
  assert.ok(text.includes('ponytail section'), 'and names what was cut')

  // A budget too small to carry the notice gets a bare slice, so the ceiling
  // holds for every budget rather than only for large ones.
  for (const budget of [10, 40, 99, 100]) {
    assert.equal(renderSection('full', budget).length, budget, `a ${budget} budget still holds the ceiling`)
  }
})

check('the runtime applies the configured budget end to end', () => {
  const runtime = PonytailRuntime({ ctx: fakeCtx(), config: resolveConfig({ maxSectionChars: 120 }), log: () => {} })
  const text = runtime.section('s')
  // The requested 120 is clamped up to the 1000 floor, and the section is only
  // about 465 characters, so a clamped budget produces a whole section rather
  // than a cut one. What matters is that the runtime never exceeds its budget.
  assert.equal(text.length, 465, 'the runtime renders the whole section under the floor')
  assert.ok(text.length <= 1000, 'and never exceeds the floor')
  assert.ok(text.includes('Ponytail is at'))
  clearLevel('s')
})

check('isActive is exactly "not off"', () => {
  assert.equal(isActive('off'), false)
  for (const level of ['lite', 'full', 'ultra']) assert.equal(isActive(level), true)
})

// ---------------------------------------------------------------------------
// §4 The prompt section.
// ---------------------------------------------------------------------------

check('the section registers with a finite order and literal text', async () => {
  const entry = await import('../src/entry-prompt.js')
  const skillEntry = await import('../src/entry-skill.js')
  const ctx = fakeCtx()
  plugin.apply(ctx, {})
  skillEntry.apply(ctx)
  entry.apply(ctx)
  const section = ctx.sections[0]
  assert.equal(section.name, 'ponytail:guide')
  assert.equal(section.interpolate, false, 'the guidance quotes command names and double quotes')
  assert.ok(Number.isFinite(section.order) && section.order > 2100, `order must be finite, got ${section.order}`)
  assert.ok(section.text({}).includes('lite') || section.text({}).includes('full'), 'a visible scope gets the guidance')
})

check('the guidance renders empty in a scope whose skill was filtered away', async () => {
  const entry = await import('../src/entry-prompt.js')
  const skillEntry = await import('../src/entry-skill.js')
  const ctx = fakeCtx({ restrictedScope: 'restricted' })
  plugin.apply(ctx, {})
  skillEntry.apply(ctx)
  entry.apply(ctx)
  assert.equal(ctx.sections[0].text({ scope: 'restricted' }), '', 'a scope without the skill must not be told to load it')
  assert.notEqual(ctx.sections[0].text({}), '', 'the global scope still gets the guidance')
})

check('the guidance renders empty when the skill registry is absent', async () => {
  const entry = await import('../src/entry-prompt.js')
  const ctx = fakeCtx({ noSkills: true })
  plugin.apply(ctx, {})
  entry.apply(ctx)
  assert.equal(ctx.sections[0].text({}), '', 'no registry must render no guidance')
})

check('the guidance renders empty when the level is off', async () => {
  const entry = await import('../src/entry-prompt.js')
  const skillEntry = await import('../src/entry-skill.js')
  const ctx = fakeCtx()
  plugin.apply(ctx, { defaultLevel: 'off' })
  skillEntry.apply(ctx)
  entry.apply(ctx)
  const text = ctx.sections[0].text({})
  assert.equal(text, '', 'an off default must render no guidance')
  assert.equal(buildSection(ctx.get('ponytail'), ctx, undefined), '', 'and the builder agrees')
})

check('the level follows the session the scope names, so a resumed session keeps its choice', async () => {
  const entry = await import('../src/entry-prompt.js')
  const skillEntry = await import('../src/entry-skill.js')
  const ctx = fakeCtx()
  plugin.apply(ctx, {})
  skillEntry.apply(ctx)
  entry.apply(ctx)
  clearLevel('s1')
  clearLevel('s2')
  // A prompt assembly's scope is the agent object, and the level is session state.
  const agentA = { session: { id: 's1' } }
  const agentB = { session: { id: 's2' } }
  assert.ok(ctx.sections[0].text({ scope: agentA }).includes('full'), 'an untouched session uses the default')
  setLevel('s1', 'ultra')
  assert.ok(ctx.sections[0].text({ scope: agentA }).includes('ultra'), 'the changed session sees its own level')
  assert.ok(ctx.sections[0].text({ scope: agentB }).includes('full'), 'another session is untouched')
  // A scope that names no session falls back to the default rather than throwing.
  assert.ok(ctx.sections[0].text({ scope: {} }).includes('full'), 'an unreachable session renders the default')
  clearLevel('s1')
  clearLevel('s2')
})

check('the guidance renders empty when the prompt is disabled by configuration', async () => {
  const entry = await import('../src/entry-prompt.js')
  const skillEntry = await import('../src/entry-skill.js')
  const ctx = fakeCtx()
  plugin.apply(ctx, { promptEnabled: false })
  skillEntry.apply(ctx)
  entry.apply(ctx)
  assert.equal(ctx.sections[0].text({}), '', 'a disabled prompt must render no guidance')
})

check('the guidance survives a context whose `skills` property read throws', async () => {
  const entry = await import('../src/entry-prompt.js')
  const skillEntry = await import('../src/entry-skill.js')
  const ctx = fakeCtx()
  plugin.apply(ctx, {})
  skillEntry.apply(ctx)
  entry.apply(ctx)
  // The exact failure recorded in docs/postmortem/0001: the property proxy's
  // ancestor-only fiber walk failing through a traceable shadow. `delete` first,
  // because an object literal's own property is non-configurable.
  delete ctx.skills
  Object.defineProperty(ctx, 'skills', {
    configurable: true,
    get () { throw new Error('cannot get property "skills" without inject') },
  })
  assert.doesNotThrow(() => ponytailSkillVisible(ctx, undefined), 'reads must go through ctx.get')
  assert.equal(ponytailSkillVisible(ctx, undefined), true, 'ctx.get still answers while the property throws')
})

check('visibility is false when there is no registry at all', () => {
  assert.equal(ponytailSkillVisible(fakeCtx({ noSkills: true }), undefined), false)
  assert.equal(ponytailSkillVisible(undefined, undefined), false)
  assert.equal(ponytailSkillVisible({}, undefined), false)
})

// ---------------------------------------------------------------------------
// §5 The skill registration.
// ---------------------------------------------------------------------------

await check('the skill registers with the fields the registry validates', async () => {
  const entry = await import('../src/entry-skill.js')
  const ctx = fakeCtx()
  const disposer = entry.apply(ctx)
  assert.equal(typeof disposer, 'function', 'the skill row must return the registration disposer')
  assert.equal(ctx.skills.length, 1, 'exactly one skill is registered')
  const skill = ctx.skills[0]
  assert.equal(skill.name, 'ponytail')
  assert.ok(skill.description.length > 40, 'a one-line description cannot route the skill')
  assert.deepEqual(skill.invocation, { modelInvocable: true, userInvocable: true })
  assert.equal(skill.provider, 'dsh-ponytail-sync', 'the provider label identifies the owning plugin')
  assert.equal(typeof skill.content, 'string')
  assert.ok(skill.content.length > 500, 'the loaded body must be the full ruleset')
  disposer()
  assert.equal(ctx.skills.length, 0, 'the disposer removes the registration')
})

await check('the skill row throws when the skills service is absent', async () => {
  const entry = await import('../src/entry-skill.js')
  const ctx = fakeCtx({ noSkills: true })
  assert.throws(() => entry.apply(ctx), /skills service is not mounted/, 'a missing seam must fail loud')
})

await check('the vendored skill body carries the load-bearing upstream rules', async () => {
  const body = await readFile(skillBodyPath(), 'utf8')
  // Each phrase is a rule upstream pins in scripts/check-rule-copies.js. A
  // reword upstream is the prompt to re-read its diff, not to edit this list.
  const INVARIANTS = [
    'in this codebase',
    'grep every caller',
    'never about the change itself',
    'shortcut: <the limit>, <when to upgrade>',
    'correct on edge cases',
    'Lazy code without its check is unfinished',
    'validation at trust boundaries',
    'prevents data loss',
    'security',
    'accessibility',
  ]
  for (const phrase of INVARIANTS) {
    assert.ok(body.includes(phrase), `the vendored skill body is missing the rule "${phrase}"`)
  }
  // The frontmatter is what the catalog shows the model before it loads.
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/u.exec(body)
  assert.ok(frontmatter, 'the skill body must start with YAML frontmatter')
  assert.ok(frontmatter[1].includes('name: ponytail'), 'the frontmatter names the skill')
  assert.ok(frontmatter[1].includes('description:'), 'the frontmatter carries the description')
  return `${INVARIANTS.length} rule invariants present`
})

// ---------------------------------------------------------------------------
// §6 The commands.
// ---------------------------------------------------------------------------

check('all six commands register, with a description and an input hint', () => {
  const ctx = fakeCtx()
  plugin.apply(ctx, {})
  registerPonytailCommands(ctx, ctx.get('ponytail'))
  const names = ctx.registered.map((entry) => entry.name)
  assert.deepEqual(names, [LEVEL_COMMAND, ...ONESHOT_NAMES], 'the six commands, level first')
  for (const entry of ctx.registered) {
    assert.ok(entry.description.length > 20, `${entry.name} needs a description a user can act on`)
    assert.equal(typeof entry.input.hint, 'string', `${entry.name} needs an input hint`)
    assert.ok(entry.input.hint.length > 0, `${entry.name} hint must not be empty`)
    assert.equal(typeof entry.handler, 'function', `${entry.name} needs a handler`)
    assert.equal(typeof entry.definitionId, 'string', `${entry.name} needs a stable definitionId`)
  }
})

check('every command registration is an effect, so unload is clean', () => {
  const ctx = fakeCtx()
  plugin.apply(ctx, {})
  registerPonytailCommands(ctx, ctx.get('ponytail'))
  const labels = ctx.effects.map((entry) => entry.label)
  // The level command's effect is labelled `level`, not `ponytail`: the label
  // names the command's role, while `LEVEL_COMMAND` is the name a user types.
  assert.ok(labels.includes('ponytail.command.level'), 'the level command must be registered as an effect')
  for (const name of ONESHOT_NAMES) {
    assert.ok(labels.includes(`ponytail.command.${name}`), `${name} must be registered as an effect`)
  }
})

check('parseLevelArgument reports with no argument and rejects an unknown level', () => {
  assert.deepEqual(parseLevelArgument(''), { kind: 'report' })
  assert.deepEqual(parseLevelArgument('   '), { kind: 'report' })
  assert.deepEqual(parseLevelArgument('ultra'), { kind: 'set', level: 'ultra' })
  assert.deepEqual(parseLevelArgument(' LITE '), { kind: 'set', level: 'lite' })
  assert.deepEqual(parseLevelArgument('off'), { kind: 'set', level: 'off' })
  const bad = parseLevelArgument('review')
  assert.equal(bad.kind, 'invalid', 'review is a session-only upstream mode, not a level here')
  assert.ok(bad.text.includes('off'), 'the rejection names the legal values')
})

check('the level command sets, reports and clears without touching another session', () => {
  const ctx = fakeCtx()
  plugin.apply(ctx, {})
  const runtime = ctx.get('ponytail')
  registerPonytailCommands(ctx, runtime)
  const level = ctx.registered.find((entry) => entry.name === LEVEL_COMMAND)
  const sessionA = { session: { id: 'a' } }
  const sessionB = { session: { id: 'b' } }
  clearLevel('a')
  clearLevel('b')

  assert.equal(level.handler({ agent: sessionA, rawInput: '' }).text.includes('full'), true, 'a report names the current level')
  assert.equal(level.handler({ agent: sessionA, rawInput: 'ultra' }).text.includes('ultra'), true, 'a set confirms the new level')
  assert.equal(level.handler({ agent: sessionB, rawInput: '' }).text.includes('full'), true, 'another session is unaffected')
  const off = level.handler({ agent: sessionA, rawInput: 'off' })
  assert.equal(off.kind, 'success')
  assert.ok(off.text.includes('off'), 'clearing reports that it is off')
  assert.equal(level.handler({ agent: sessionA, rawInput: 'bogus' }).kind, 'error', 'an unknown level is an error, not a silent no-op')
  clearLevel('a')
  clearLevel('b')
})

check('a one-shot command injects one instruction message and reports', () => {
  const ctx = fakeCtx()
  plugin.apply(ctx, {})
  registerPonytailCommands(ctx, ctx.get('ponytail'))
  const injected = []
  const agent = {
    session: { id: 's' },
    inject: (message) => injected.push(message),
  }
  const review = ctx.registered.find((entry) => entry.name === 'ponytail-review')
  const result = review.handler({ agent, rawInput: '' })
  assert.equal(result.kind, 'success')
  assert.equal(injected.length, 1, 'exactly one message is injected')
  const message = injected[0]
  assert.equal(message.role, 'user', 'the injection is a user-role instruction')
  assert.ok(Array.isArray(message.content) && message.content[0].type === 'text')
  assert.ok(message.content[0].text.includes('What this change does'), 'the review instruction states its output shape')
  assert.equal(typeof message.source, 'object', 'the message carries a source the session log reads')
  assert.equal(typeof message.id, 'string', 'the message carries a stable identity')

  review.handler({ agent, rawInput: 'src/index.js' })
  assert.equal(injected.length, 2, 'a second invocation injects again')
  assert.ok(injected[1].content[0].text.includes('src/index.js'), 'a named target is folded into the instruction')
  assert.notEqual(injected[0].id, injected[1].id, 'two injections never share an identity')
})

check('a one-shot command tolerates an agent without an inject seam', () => {
  const ctx = fakeCtx()
  plugin.apply(ctx, {})
  registerPonytailCommands(ctx, ctx.get('ponytail'))
  const help = ctx.registered.find((entry) => entry.name === 'ponytail-help')
  assert.doesNotThrow(() => help.handler({ agent: {}, rawInput: '' }), 'a missing inject must not throw')
  assert.equal(help.handler({ agent: {}, rawInput: '' }).kind, 'success', 'and still reports')
})

check('every one-shot instruction body is non-trivial and names its output shape', () => {
  for (const name of ONESHOT_NAMES) {
    const text = oneshotInstructions(name)
    assert.ok(text.length > 200, `${name} instructions are too thin to follow`)
  }
  assert.ok(oneshotInstructions('ponytail-review').includes('What this change does'))
  assert.ok(oneshotInstructions('ponytail-audit').includes('What this repo does'))
  assert.ok(oneshotInstructions('ponytail-debt').includes('shortcut'))
  assert.ok(oneshotInstructions('ponytail-gain').includes('benchmark averages'))
})

check('the help card lists all six commands and the levels', () => {
  const card = helpCard()
  for (const name of [LEVEL_COMMAND, ...ONESHOT_NAMES]) {
    assert.ok(card.includes(`/${name}`), `the help card omits /${name}`)
  }
  for (const level of ['lite', 'full', 'ultra', 'off']) {
    assert.ok(card.includes(level), `the help card omits ${level}`)
  }
})

check('instructionMessage freezes its output', () => {
  const message = instructionMessage('text')
  assert.equal(Object.isFrozen(message), true, 'the session log reads an immutable message')
})

// ---------------------------------------------------------------------------
// §7 Publishing.
// ---------------------------------------------------------------------------

/**
 * Read this package's manifest.
 *
 * @returns {any} the parsed package.json.
 */
function manifest () {
  return JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
}

check('the bundle patch resolves against the package', async () => {
  const patch = await readFile(join(ROOT, 'cordis.patch.yml'), 'utf8')
  for (const name of localModuleNames(patch)) {
    assert.ok(existsSync(resolve(ROOT, name)), `cordis.patch.yml inserts ${name}, which does not exist`)
  }
  const declared = manifest()
  for (const name of externalModuleNames(patch)) {
    assert.ok(declared.peerDependencies?.[name] || declared.dependencies?.[name],
      `cordis.patch.yml inserts ${name}, which the manifest does not declare`)
  }
  for (const target of Object.values(declared.exports)) {
    assert.ok(existsSync(resolve(ROOT, target)), `the export ${target} is not committed`)
  }
  for (const entry of declared.files) {
    assert.ok(existsSync(resolve(ROOT, entry)), `package.json ships ${entry}, which does not exist`)
  }
})

check('the package installs from git with no build permission', () => {
  const declared = manifest()
  // pnpm runs only `prepack` and `prepare` on a git dependency. Either would make
  // pnpm refuse the install until the user allowlists this package's build script,
  // stopping anyone installing from GitHub at the first step.
  const gitInstallScripts = ['prepare', 'prepack', 'preinstall', 'postinstall', 'install']
    .filter(name => declared.scripts?.[name] !== undefined)
  assert.deepEqual(gitInstallScripts, [], `a git install would need build permission: ${gitInstallScripts.join(', ')}`)
  // `prepublishOnly` is fine: pnpm does not run it on a git dependency.
  assert.equal(declared.private, undefined, 'a private package cannot be published to npm')
})

check('the declared icon is a real image the plugin panel can render', () => {
  const declared = manifest()
  assert.deepEqual(checkIcon(declared), [], 'the icon declaration is invalid')
  // The panel reads the icon without activating the plugin, so a broken one
  // silently falls back to default artwork rather than failing the load.
  const icon = resolve(ROOT, declared.icon)
  assert.ok(existsSync(icon) && readFileSync(icon, 'utf8').length > 0, 'the icon file is missing or empty')
})

check('an icon that pulls in outside resources does not pass', async () => {
  const decoy = join(ROOT, 'icon-decoy.svg')
  const hostile = {
    'remote image': '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.com/x.png"/></svg>',
    'inline script': '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    'remote css': '<svg xmlns="http://www.w3.org/2000/svg"><style>@import url(https://example.com/x.css);</style></svg>',
  }
  try {
    for (const [label, body] of Object.entries(hostile)) {
      await writeFile(decoy, body)
      assert.match(checkIcon({ icon: './icon-decoy.svg', files: ['icon-decoy.svg'] })[0],
        /not self-contained/, `${label} was accepted as an icon`)
    }
  } finally {
    await rm(decoy, { force: true })
  }
})

check('the icon check rejects the declarations the harness refuses', () => {
  assert.match(checkIcon({ icon: '/etc/passwd' })[0], /relative to the package/)
  assert.match(checkIcon({ icon: 'https://example.com/i.png' })[0], /relative to the package/)
  assert.match(checkIcon({ icon: './missing.png' })[0], /does not exist/)
  assert.match(checkIcon({ icon: './icon.txt', files: ['icon.txt'] })[0], /supported image extension/)
  assert.match(checkIcon({ icon: './icon.svg', files: [] })[0], /not listed in files/)
  assert.deepEqual(checkIcon({}), [], 'an omitted icon is allowed')
})

check('the icon image is square, so a panel row does not distort it', () => {
  const declared = manifest()
  const source = readFileSync(resolve(ROOT, declared.icon), 'utf8')
  const viewBox = /viewBox="[^"]*?([\d.]+) ([\d.]+)"/.exec(source)
  assert.notEqual(viewBox, null, 'the icon SVG has no viewBox, so it has no intrinsic shape')
  assert.equal(Number(viewBox[1]), Number(viewBox[2]), 'the icon is not square')
})

check('the declared peers are resolvable by an installing profile', () => {
  const declared = manifest()
  // A peer that npm cannot resolve fails the whole install. The one peer here is
  // a harness package that lives in the running profile rather than on the public
  // registry, so it is optional: a profile that provides it still gets it, and a
  // registry install that cannot see it is not refused over it.
  for (const name of Object.keys(declared.peerDependencies ?? {})) {
    assert.equal(declared.peerDependenciesMeta?.[name]?.optional, true,
      `${name} is a required peer, so npm must be able to resolve it`)
  }
})

check('the tarball npm would publish carries every file the plugin needs', async () => {
  const pack = await readPackManifest()
  const missing = missingFromPack(pack.files)
  assert.deepEqual(missing, [], `npm would not publish: ${missing.join(', ')}`)
  assert.ok(pack.entryCount >= REQUIRED_FILES.length, `the tarball has only ${pack.entryCount} files`)
})

check('missingFromPack names exactly what is absent', () => {
  assert.deepEqual(missingFromPack(REQUIRED_FILES), [], 'a complete list has nothing missing')
  assert.deepEqual(missingFromPack(REQUIRED_FILES.slice(1)), [REQUIRED_FILES[0]],
    'a list missing one entry names that entry')
  assert.deepEqual(missingFromPack([]), REQUIRED_FILES, 'an empty list misses everything')
})

check('the licence and its notice ship with the package', () => {
  const declared = manifest()
  assert.equal(declared.license, 'MIT', 'the vendored prompt is MIT')
  for (const file of ['LICENSE', 'NOTICE', 'README.md']) {
    assert.ok(declared.files.includes(file), `${file} is not in files, so it is not published`)
    assert.ok(existsSync(resolve(ROOT, file)), `${file} does not exist`)
  }
  // MIT requires the notice to travel with the copy, and this package redistributes
  // an upstream prompt, so the upstream attribution has to be present.
  const notice = readFileSync(resolve(ROOT, 'NOTICE'), 'utf8')
  assert.ok(notice.includes('DietrichGebert/ponytail'), 'NOTICE does not attribute the upstream prompt')
})

check('the vendored skill body ships and is not empty', async () => {
  const body = await readFile(skillBodyPath(), 'utf8')
  assert.ok(body.includes('---'), 'the vendored SKILL.md has no frontmatter')
  assert.ok(body.length > 1000, `the vendored SKILL.md is only ${body.length} characters`)
  assert.ok(manifest().files.includes('assets'), 'assets/ is not shipped, so the skill has no body')
})

// ---------------------------------------------------------------------------

process.stdout.write('\ndsh-ponytail-sync plugin contract: all checks passed\n')
