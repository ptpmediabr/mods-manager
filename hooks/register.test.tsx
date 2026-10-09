import { expect, mock, test } from 'claude-code/testing'

import { describe, matches, parseAvailable, parseInstalled, passes, profileChanges, providesLine, shorten } from './lib'

const PANE = {
  component: 'Pane',
  requestId: 'mods-manager',
  props: {
    title: 'Mods',
    isFocused: true,
    bodyColumns: 64,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const LIST = [
  { id: 'b@m', scope: 'user', enabled: true, version: '1.0.0', installPath: '/p/b' },
  { id: 'a@m', scope: 'local', enabled: true, projectPath: '/elsewhere' },
  { id: 'a@m', scope: 'user', enabled: false, version: 'unknown' },
  { id: 'c@synced', scope: 'synced', enabled: true },
  { id: 't@m', scope: 'user', enabled: true, mcpServers: { tele: {} } },
]

const LONG = 'A side chat pane inside the session that answers questions or runs requests on a model.'

const row = (id: string, isEnabled: boolean) => ({
  id,
  scope: 'user',
  version: '',
  isEnabled,
  canToggle: true,
  installPath: '',
  mcp: [],
  provides: '',
  description: '',
})

test('the list keeps this project and the person, each once', () => {
  const rows = parseInstalled(JSON.stringify(LIST), '/work')
  expect(rows.map(one => `${one.id} ${one.scope} ${one.isEnabled} ${one.canToggle}`)).toEqual([
    'a@m user false true',
    'b@m user true true',
    'c@synced synced true false',
    't@m user true true',
  ])
  expect(rows[3]?.mcp).toEqual(['tele'])
  expect(parseInstalled('not json', '/work')).toEqual([])
  expect(describe({ ...row('codex@openai-codex', true), version: '1.0.1' })).toEqual({
    name: 'codex',
    meta: 'openai-codex · user',
    full: 'openai-codex · v1.0.1 · user',
  })
})

test('the small helpers', () => {
  expect(shorten('short')).toBe('short')
  expect(shorten('A side chat pane inside the session that answers questions or runs requests on a model.')).toBe(
    'A side chat pane inside the session that…',
  )
  expect(matches('', 'x')).toBe(true)
  expect(matches('DEX', 'codex@openai')).toBe(true)
  expect(matches('zzz', 'codex')).toBe(false)
  expect([passes('all', false), passes('on', true), passes('on', false), passes('off', false), passes('off', true)]).toEqual([
    true,
    true,
    false,
    true,
    false,
  ])
  expect(providesLine({ skills: 3, comandos: 0, agentes: 1 }, ['tele'])).toBe('3 skills · 1 agentes · MCP: tele')
  expect(providesLine({}, [])).toBe('nada detectado')
  expect(parseAvailable(JSON.stringify({ available: [{ pluginId: 'x@m', name: 'x', description: 'd' }] }))).toEqual([
    { id: 'x@m', name: 'x', description: 'd' },
  ])
  expect(profileChanges([row('a', true), row('b', false), row('c', true)], { name: 'p', ids: ['b', 'c'] }).map(r => r.id)).toEqual([
    'a',
    'b',
  ])
})

test('toggles, the MCP confirmation, the filter and a profile', async ($, on) => {
  mock.store(on)
  mock.env(on, { HOME: '/home/me', CLAUDE_CODE_EXECPATH: '/bin/claude-own' })
  const state = LIST.map(one => ({ ...one }))
  const ran: string[] = []
  let reloads = 0
  on('session.id', () => ({ value: 'abc' }))
  on('session.cwd', () => ({ value: '/work' }))
  on('fs.list', (_, e) => ({
    value:
      e.path === '/p/b/skills'
        ? [{ name: 's1', kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false }]
        : [],
  }))
  on('fs.read', (_, e) => ({
    value: e.path === '/p/b/.claude-plugin/plugin.json' ? JSON.stringify({ name: 'b', description: LONG }) : '{}',
  }))
  on('command.run', () => {
    reloads += 1

    return { text: 'ok' }
  })
  on('process.run', (_, e) => {
    const [bin, , verb, id] = e.argv
    expect(bin).toBe('/bin/claude-own')
    if (verb !== 'list') {
      ran.push(`${verb} ${id}`)
      for (const one of state) {
        if (one.id === id && one.scope === 'user') {
          one.enabled = verb === 'enable'
        }
      }
    }

    return {
      value: { exitCode: 0, stdout: JSON.stringify(state), stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
    }
  })

  const ui = await $.ui.mount({ plugin: 'mods-manager', surface: 'desktop', ...PANE })
  await ui.press({ key: 'refresh' })
  expect((await ui.find({ key: 'plugin:b@m:user' }))?.props.label).toBe('Ligado')
  expect((await ui.find({ key: 'plugin:a@m:user' }))?.props.label).toBe('Desligado')
  expect(await ui.find({ key: 'plugin:c@synced:synced' })).toBeUndefined()

  // the switch is a Button with its chrome, a colored dot before the state
  expect((await ui.find({ key: 'plugin:b@m:user' }))?.props.plain).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: '●' }))?.props.color).toBeDefined()
  expect(await ui.find({ type: 'Svg' })).toBeUndefined()

  // a row opens with its description, cut short, and never its version
  expect(await ui.find({ type: 'Text', text: 'A side chat pane inside the session that…' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'v1.0.0' })).toBeUndefined()

  // details show the whole description, the version and what the plugin brings
  await ui.press({ key: 'more:b@m user' })
  expect(await ui.find({ type: 'Text', text: LONG })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'm · v1.0.0 · user' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Traz: 1 skills' })).toBeDefined()

  // a profile of what is on now: b and t
  await ui.input({ key: 'profile-0', text: 'base' })
  expect(await ui.find({ type: 'Text', text: '2 plugins ligados' })).toBeDefined()

  // a plain toggle switches and reloads
  await ui.press({ key: 'plugin:b@m:user' })
  expect(ran).toEqual(['disable b@m'])
  expect(reloads).toBe(1)
  expect((await ui.find({ key: 'plugin:b@m:user' }))?.props.label).toBe('Desligado')

  // a plugin with MCP servers asks first
  await ui.press({ key: 'plugin:t@m:user' })
  expect(ran).toEqual(['disable b@m'])
  expect((await ui.find({ key: 'plugin:t@m:user' }))?.props.label).toBe('Desligar?')
  await ui.press({ key: 'plugin:t@m:user' })
  expect(ran).toEqual(['disable b@m', 'disable t@m'])

  // the profile brings both back
  await ui.press({ key: 'use:base' })
  expect(ran.slice(2).sort()).toEqual(['enable b@m', 'enable t@m'])
  expect((await ui.find({ key: 'plugin:b@m:user' }))?.props.label).toBe('Ligado')

  // the filter narrows the rows
  await ui.input({ key: 'q', text: 't@', kind: 'change' })
  expect(await ui.find({ key: 'plugin:b@m:user' })).toBeUndefined()
  expect(await ui.find({ key: 'plugin:t@m:user' })).toBeDefined()
  await ui.input({ key: 'q', text: '', kind: 'change' })

  // only the ones off: a is off, b and t are on
  await ui.press({ key: 'only-off' })
  expect(await ui.find({ key: 'plugin:a@m:user' })).toBeDefined()
  expect(await ui.find({ key: 'plugin:b@m:user' })).toBeUndefined()
  // the two buttons exclude each other
  await ui.press({ key: 'only-on' })
  expect(await ui.find({ key: 'plugin:a@m:user' })).toBeUndefined()
  expect(await ui.find({ key: 'plugin:b@m:user' })).toBeDefined()
  // pressing the lit one shows every row again
  await ui.press({ key: 'only-on' })
  expect(await ui.find({ key: 'plugin:a@m:user' })).toBeDefined()
  expect(await ui.find({ key: 'plugin:b@m:user' })).toBeDefined()
  await ui.unmount()
})

test('the pane draws without inputs on a terminal too', async ($, on) => {
  mock.store(on)
  mock.env(on, { HOME: '/home/me' })
  on('session.id', () => ({ value: 'abc' }))
  on('session.cwd', () => ({ value: '/work' }))
  on('fs.list', () => ({ value: [] }))
  on('process.run', () => ({
    value: { exitCode: 0, stdout: JSON.stringify(LIST), stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  const ui = await $.ui.mount({ plugin: 'mods-manager', surface: 'terminal', ...PANE })
  await ui.press({ key: 'refresh' })
  expect(await ui.find({ key: 'plugin:b@m:user' })).toBeDefined()
  await ui.unmount()
})
