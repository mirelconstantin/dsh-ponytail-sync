/**
 * The six ponytail slash commands.
 *
 * Upstream delivers these as agent-specific command files and, where the host
 * supports it, as skills. Here they are registered on the harness's own command
 * registry, which every composed command adapter renders — so `/ponytail` works
 * in the Web GUI and the desktop shell the same way, with no per-agent plumbing.
 *
 * One of them is stateful and five are not.
 *
 * `/ponytail` is the only one that changes state: it sets the level for the
 * invoking session and reports what is now in force. With no argument it reports
 * the current level rather than resetting it, which is upstream's behaviour and
 * the only safe default — a stray `/ponytail` inside a longer message must not
 * silently change a level.
 *
 * The other five are one-shot prompts. A command handler runs before the model
 * sees the turn, so these cannot answer in place; they inject one instruction
 * message into the session's next step, which makes the resulting model turn
 * ordinary logged conversation rather than a hidden side channel.
 *
 * The injected message is built locally rather than through the harness's own
 * message constructor. This plugin is self-contained by design — every other
 * local plugin in this profile resolves only `node:` builtins and its own
 * sources — and the fields the session log requires (`role`, `content`,
 * `source`) are the documented public shape. The missing piece is a stable
 * identity, which `freezeMessage` supplies from `node:crypto` so two injections
 * in one session never collide.
 *
 * @module dsh-ponytail-sync/commands
 */

import { randomUUID } from 'node:crypto'

import { isLevel, LEVELS, normalizeLevel } from './config.js'
import { isActive } from './runtime.js'

/**
 * The five one-shot command names, in the order the help card lists them.
 *
 * @type {readonly string[]}
 */
export const ONESHOT_NAMES = Object.freeze([
  'ponytail-review',
  'ponytail-audit',
  'ponytail-debt',
  'ponytail-gain',
  'ponytail-help',
])

/**
 * The level command's name.
 *
 * @type {string}
 */
export const LEVEL_COMMAND = 'ponytail'

/** One line per command, for the command registry and the help card. */
export const DESCRIPTIONS = Object.freeze({
  [LEVEL_COMMAND]: 'Set the ponytail level for this session, or report the current one',
  'ponytail-review': 'Review the current change: bugs, security, load, missing tests, speed, what to cut',
  'ponytail-audit': 'The same review for the whole repository, most important first',
  'ponytail-debt': 'Harvest shortcut: comments into a tracked debt ledger',
  'ponytail-gain': 'Show the measured-impact scoreboard',
  'ponytail-help': 'Quick reference for the ponytail commands',
})

/**
 * Parse the `/ponytail` argument.
 *
 * @param {string} rawInput - the argument text after the command name.
 * @returns {{ kind: 'report' } | { kind: 'set', level: string } | { kind: 'invalid', text: string }} the parsed request.
 */
export function parseLevelArgument (rawInput) {
  const text = typeof rawInput === 'string' ? rawInput.trim().toLowerCase() : ''
  if (text === '') return { kind: 'report' }
  if (isLevel(text)) return { kind: 'set', level: text }
  return { kind: 'invalid', text: `/ponytail takes ${LEVELS.join(', ')} or no argument.` }
}

/**
 * The help card, as the one-shot text the help command injects.
 *
 * @returns {string} the card.
 */
export function helpCard () {
  return [
    '## Ponytail',
    '',
    'Lazy senior dev mode: the smallest change that fully solves the task. The level for this session is in the prompt section; `/ponytail` reports it.',
    '',
    '| Command | What it does |',
    '| --- | --- |',
    `| \`/ponytail [${LEVELS.join('\\|')}]\` | Set the level for this session, or report the current one |`,
    '| `/ponytail-review` | Review the current change: bugs, security, load, missing tests, speed, what to cut |',
    '| `/ponytail-audit` | The same review for the whole repository, most important first |',
    '| `/ponytail-debt` | Harvest `shortcut:` comments into a tracked debt ledger |',
    '| `/ponytail-gain` | Show the measured-impact scoreboard |',
    '| `/ponytail-help` | This card |',
    '',
    'Deactivate with `/ponytail off`. The default level for new sessions is a configuration field, not a file to edit.',
  ].join('\n')
}

/**
 * The instruction body each one-shot command injects.
 *
 * Each one says what to do and points at the skill body for the full procedure,
 * so the command works whether or not the model has already loaded the skill.
 *
 * @param {string} name - the one-shot command name.
 * @returns {string} the instructions for that command.
 */
export function oneshotInstructions (name) {
  switch (name) {
    case 'ponytail-review':
      return [
        'Review the current change with ponytail. Order of importance: correct, safe, holds under load, tested, fast, lean. Load the `ponytail` skill first if it is not already in context — its "Reviewing a change" section is the full procedure.',
        '',
        'Review what I named; with nothing named, the uncommitted changes, or the last commit if there are none. Read the diff, then the code it touches: callers of every changed function, the functions it calls, the tests, the README. Say which load you assumed.',
        '',
        'Every finding needs a concrete case. Propose the smallest fix, prefer deleting code, and add no layers. Start with `What this change does:`. Report, change no code.',
      ].join('\n')
    case 'ponytail-audit':
      return [
        'Audit this repository with ponytail: the same checks as a review, over the whole repository, most important first. Load the `ponytail` skill first if it is not already in context — its "Auditing a repository" section is the full procedure.',
        '',
        'Audit what I named; with nothing named, the whole repository. Read the README, the deploy and build config, the dependency list, the entry points and the tests. Trace the main flows end to end. Go deep where a mistake costs the most, and say which parts you did not read.',
        '',
        'Start with `What this repo does:`. At most 20 findings. End with `Verdict:` naming what to fix first, and `Not checked:`. Report, change no code.',
      ].join('\n')
    case 'ponytail-debt':
      return [
        'Harvest the `shortcut:` comments in this repository into a ledger. Load the `ponytail` skill first if it is not already in context — its "The shortcut ledger" section is the full procedure.',
        '',
        'Search the tree, skipping `node_modules`, `.git` and build output:',
        '',
        "grep -rnE --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=build '(#|//|/\\*)? ?(shortcut|ponytail):' .",
        '',
        'One row per marker, grouped by file, as `<file>:<line>, <what was simplified>. ceiling: <the limit named>. upgrade: <the trigger to revisit>.` Tag any marker with no upgrade path as `no-trigger`. End with `<N> markers, <M> with no trigger.` Nothing found: `No shortcut debt. Clean ledger.`',
        '',
        'Reads and reports only, change nothing.',
      ].join('\n')
    case 'ponytail-gain':
      return [
        'Show the ponytail measured-impact scoreboard. One-shot display: change no code and no mode.',
        '',
        'The figures are the published agentic benchmark of Ponytail 5 — headless Claude Code (Opus 5.5) on 39 tasks, 5 runs each, against the same agent without the skill:',
        '',
        '- Lines of code: 47% of the no-skill baseline',
        '- Output tokens: 55%',
        '- Cost: 74%',
        '- Time: 59%',
        '- Tests where the logic needs one: 98% (no-skill 68%)',
        '',
        'These are benchmark averages, never this repository. Do not print a per-repo savings number: the unbuilt version was never written, so there is no baseline to subtract from. Per-repo figures come from `/ponytail-debt` (a counted ledger) and `/ponytail-audit` (what is still cuttable).',
      ].join('\n')
    case 'ponytail-help':
      return helpCard()
    /* v8 ignore next -- ONESHOT_NAMES is closed and every member is handled above */
    default:
      return helpCard()
  }
}

/**
 * Build one user-role instruction message with a stable identity.
 *
 * `role`, `content` and `source` are the fields the session log reads; the
 * identity comes from `node:crypto` so two injections in one session never
 * collide. The object is frozen, matching the harness's own message constructor.
 *
 * @param {string} text - the instruction text.
 * @returns {any} an immutable user-role message.
 */
export function instructionMessage (text) {
  return Object.freeze({
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
    id: randomUUID(),
  })
}

/**
 * The session id of a command invocation.
 *
 * @param {any} invocation - the command invocation.
 * @returns {string | undefined} the session id, when the agent exposes one.
 */
function sessionIdOf (invocation) {
  const session = invocation?.agent?.session
  if (typeof session === 'string') return session
  if (session && typeof session.id === 'string') return session.id
  return undefined
}

/**
 * Register every ponytail command.
 *
 * Each registration is its own effect, so disposing one row does not disturb the
 * others and the registry is clean at unload.
 *
 * @param {any} ctx - Cordis context providing `commands`.
 * @param {any} runtime - the ponytail runtime.
 * @returns {void} nothing.
 */
export function registerPonytailCommands (ctx, runtime) {
  const commands = typeof ctx?.get === 'function' ? ctx.get('commands') : undefined
  if (!commands || typeof commands.register !== 'function') {
    throw new Error('dsh-ponytail-sync: the commands service is not mounted')
  }

  ctx.effect(() => commands.register({
    definitionId: 'dsh-ponytail-sync/level',
    name: LEVEL_COMMAND,
    description: DESCRIPTIONS[LEVEL_COMMAND],
    input: { hint: `[${LEVELS.join('|')}]` },
    handler: (invocation) => {
      const parsed = parseLevelArgument(invocation.rawInput)
      if (parsed.kind === 'invalid') return { kind: 'error', text: parsed.text }
      const sessionId = sessionIdOf(invocation)
      if (parsed.kind === 'report') {
        const level = runtime.levelFor(sessionId)
        const state = isActive(level) ? `active at ${level}` : 'off'
        const list = LEVELS.filter((entry) => entry !== 'off').map((entry) => `/ponytail ${entry}`).join(', ')
        return { kind: 'success', text: `Ponytail is ${state}.\n${list}, or /ponytail off.` }
      }
      const level = runtime.setLevelFor(sessionId, parsed.level)
      return {
        kind: 'success',
        text: isActive(level)
          ? `Ponytail level set to ${level} for this session.`
          : 'Ponytail is off for this session.',
      }
    },
  }), 'ponytail.command.level')

  for (const name of ONESHOT_NAMES) {
    ctx.effect(() => commands.register({
      definitionId: `dsh-ponytail-sync/${name}`,
      name,
      description: DESCRIPTIONS[name],
      input: { hint: '[optional target]' },
      handler: (invocation) => {
        const extra = typeof invocation.rawInput === 'string' ? invocation.rawInput.trim() : ''
        const body = oneshotInstructions(name)
        const text = extra === '' ? body : `${body}\n\nScope I named: ${extra}`
        const agent = invocation?.agent
        if (agent && typeof agent.inject === 'function') {
          agent.inject(instructionMessage(text))
        }
        return { kind: 'success', text: `${name} runs in the next step.` }
      },
    }), `ponytail.command.${name}`)
  }
}

/**
 * A level, normalised to the configured fallback.
 *
 * Re-exported so a caller does not need the config module for this one fact.
 *
 * @param {unknown} value - the candidate level.
 * @returns {string} a level.
 */
export function asLevel (value) {
  return normalizeLevel(value, 'full')
}
