import type { Installed, Only, Profile } from '../types'

type Listed = {
  id?: string
  scope?: string
  version?: string
  enabled?: boolean
  projectPath?: string
  installPath?: string
  mcpServers?: Record<string, unknown>
}

export type Available = { id: string; name: string; description: string }

// `claude plugin list --json` as rows: the person's own installs and this
// project's, each once; another project's install is left out, and a scope
// the CLI cannot switch (a synced plugin) is shown without a toggle.
export const parseInstalled = (stdout: string, cwd: string): Installed[] => {
  let listed: unknown
  try {
    listed = JSON.parse(stdout)
  } catch {
    return []
  }
  const seen = new Set<string>()
  const rows: Installed[] = []
  for (const one of (Array.isArray(listed) ? listed : []) as Listed[]) {
    const { id, scope = 'user' } = one
    const isElsewhere = one.projectPath !== undefined && one.projectPath !== cwd
    if (id === undefined || isElsewhere || seen.has(`${id} ${scope}`)) {
      continue
    }
    seen.add(`${id} ${scope}`)
    rows.push({
      id,
      scope,
      version: one.version === undefined || one.version === 'unknown' ? '' : one.version,
      isEnabled: one.enabled === true,
      canToggle: scope === 'user' || scope === 'project' || scope === 'local',
      installPath: one.installPath ?? '',
      mcp: Object.keys(one.mcpServers ?? {}),
      provides: '',
      description: '',
    })
  }

  return rows.sort((a, b) => a.id.localeCompare(b.id))
}

// `claude plugin list --available --json`: what the marketplaces offer.
export const parseAvailable = (stdout: string): Available[] => {
  let parsed: { available?: { pluginId?: string; name?: string; description?: string }[] }
  try {
    parsed = JSON.parse(stdout) as typeof parsed
  } catch {
    return []
  }
  const out: Available[] = []
  for (const one of Array.isArray(parsed.available) ? parsed.available : []) {
    if (one.pluginId !== undefined) {
      out.push({ id: one.pluginId, name: one.name ?? one.pluginId, description: one.description ?? '' })
    }
  }

  return out
}

export const matches = (query: string, ...texts: readonly string[]) => {
  const wanted = query.trim().toLowerCase()

  return wanted === '' || texts.some(text => text.toLowerCase().includes(wanted))
}

// The on/off filter: every row, or only the ones in that state.
export const passes = (only: Only, isOn: boolean) => only === 'all' || (only === 'on') === isOn

// What a plugin brings, in one line: "3 skills · 2 comandos · MCP: telegram".
export const providesLine = (counts: Readonly<Record<string, number>>, mcp: readonly string[]) => {
  const parts = Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([what, n]) => `${n} ${what}`)
  if (mcp.length > 0) {
    parts.push(`MCP: ${mcp.join(', ')}`)
  }

  return parts.length === 0 ? 'nada detectado' : parts.join(' · ')
}

export type SwitchLook = 'on' | 'off' | 'busy'

// A long description's opening, cut at a word; the text itself when it fits.
export const SHORT = 44

export const shorten = (text: string): string => {
  if (text.length <= SHORT) {
    return text
  }
  const head = text.slice(0, SHORT)
  const space = head.lastIndexOf(' ')

  return `${(space > SHORT / 2 ? head.slice(0, space) : head).trimEnd()}…`
}

export const manifestOf = (text: string): { name?: string; description?: string } => {
  try {
    return JSON.parse(text) as { name?: string; description?: string }
  } catch {
    return {}
  }
}

export const offList = (stored: unknown): string[] =>
  Array.isArray(stored) ? stored.filter((x): x is string => typeof x === 'string') : []

export const profileList = (stored: unknown): Profile[] =>
  (Array.isArray(stored) ? stored : []).filter(
    (x): x is Profile =>
      typeof x === 'object' && x !== null && typeof (x as Profile).name === 'string' && Array.isArray((x as Profile).ids),
  )

// A row's words: the plugin's own name, where it comes from, and the same
// with its version, which only the details show.
export const describe = (row: Installed): { name: string; meta: string; full: string } => {
  const at = row.id.lastIndexOf('@')
  const name = at > 0 ? row.id.slice(0, at) : row.id
  const source = at > 0 ? row.id.slice(at + 1) : ''
  const version = row.version === '' ? '' : `v${row.version}`
  const join = (parts: readonly string[]) => parts.filter(part => part !== '').join(' · ')

  return { name, meta: join([source, row.scope]), full: join([source, version, row.scope]) }
}

// The rows a profile would switch: each one whose state differs from it.
export const profileChanges = (rows: readonly Installed[], profile: Profile) =>
  rows.filter(row => row.canToggle && row.isEnabled !== profile.ids.includes(row.id))
