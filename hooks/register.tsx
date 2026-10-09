import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { DevMod, Installed, Only, Profile } from '../types'
import {
  SHORT,
  describe,
  manifestOf,
  matches,
  offList,
  passes,
  parseAvailable,
  parseInstalled,
  profileChanges,
  profileList,
  providesLine,
  shorten,
} from './lib'
import type { Available, SwitchLook } from './lib'

const PANE = 'mods-manager'
const STORE_OFF = 'off'
const STORE_PROFILES = 'profiles'
// The switch is a Button with its chrome (the terminal's `[ … ]`, a desktop's
// native button), so it reads as something to press: a dot, green while on
// and grey while off, then the state's name. A press flips it.
const DOT = '●'
const DOT_ON = '#30b566'
const DOT_OFF = '#8a8f98'
const SWITCH_ON = 'Ligado'
const SWITCH_OFF = 'Desligado'
const SWITCH_BUSY = '…'
const MAX_OFFERS = 8

const installed = atom({ plugin: 'mods-manager', key: 'installed' } as const, [])
const devMods = atom({ plugin: 'mods-manager', key: 'devMods' } as const, [])
const off = atom({ plugin: 'mods-manager', key: 'off' } as const, [])
const expanded = atom({ plugin: 'mods-manager', key: 'expanded' } as const, [])
const busy = atom({ plugin: 'mods-manager', key: 'busy' } as const, [])
const pending = atom({ plugin: 'mods-manager', key: 'pending' } as const, [])
const profiles = atom({ plugin: 'mods-manager', key: 'profiles' } as const, [])
const confirm = atom({ plugin: 'mods-manager', key: 'confirm' } as const, '')
const query = atom({ plugin: 'mods-manager', key: 'query' } as const, '')
const only = atom({ plugin: 'mods-manager', key: 'only' } as const, 'all')
const isCatalogLoaded = atom({ plugin: 'mods-manager', key: 'isCatalogLoaded' } as const, false)
const note = atom({ plugin: 'mods-manager', key: 'note' } as const, '')
const isLoading = atom({ plugin: 'mods-manager', key: 'isLoading' } as const, false)

// What the marketplaces offer: thousands of rows, kept out of the state.
let catalog: Available[] = []

// The CLI of the build this session runs, not whichever `claude` is on PATH.
async function claude($: EngineInterface, args: readonly string[], timeoutMs: number) {
  const own = await $.env.get('CLAUDE_CODE_EXECPATH')

  return $.process.run([own ?? 'claude', 'plugin', ...args], { timeoutMs }).catch(() => undefined)
}

async function sessionFolder($: EngineInterface) {
  const home = await $.env.get('HOME')

  return home === undefined ? undefined : `${home}/.claude/dev-mods/${await $.session.id()}`
}

// The mods being written in this session's mods folder, this one left out.
async function listDevMods($: EngineInterface): Promise<DevMod[]> {
  const folder = await sessionFolder($)
  if (folder === undefined) {
    return []
  }
  const entries = await $.fs.list(folder).catch(() => [])
  const found: DevMod[] = []
  for (const entry of entries) {
    const root = `${folder}/${entry.name}`
    if (entry.kind !== 'dir' || root === $.plugin.root) {
      continue
    }
    const text = await $.fs.read(`${root}/.claude-plugin/plugin.json`).catch(() => undefined)
    if (text === undefined) {
      continue
    }
    const manifest = manifestOf(text)
    found.push({ name: manifest.name ?? entry.name, root, description: manifest.description ?? '' })
  }

  return found.sort((a, b) => a.name.localeCompare(b.name))
}

async function countIn($: EngineInterface, folder: string) {
  const entries = await $.fs.list(folder).catch(() => [])

  return entries.filter(entry => !entry.name.startsWith('.')).length
}

async function withProvides($: EngineInterface, row: Installed): Promise<Installed> {
  if (row.installPath === '') {
    return { ...row, provides: providesLine({}, row.mcp) }
  }
  const [skills, comandos, agentes, hooks, manifest] = await Promise.all([
    countIn($, `${row.installPath}/skills`),
    countIn($, `${row.installPath}/commands`),
    countIn($, `${row.installPath}/agents`),
    countIn($, `${row.installPath}/hooks`),
    $.fs.read(`${row.installPath}/.claude-plugin/plugin.json`).catch(() => undefined),
  ])

  return {
    ...row,
    provides: providesLine({ skills, comandos, agentes, hooks: hooks > 0 ? 1 : 0 }, row.mcp),
    description: manifest === undefined ? '' : (manifestOf(manifest).description ?? ''),
  }
}

async function refresh($: EngineInterface) {
  await update($, isLoading, () => true)
  const cwd = await $.session.cwd()
  const listed = await claude($, ['list', '--json'], 30000)
  if (listed === undefined || listed.exitCode !== 0) {
    await update($, note, () => 'Erro: não consegui rodar `claude plugin list`.')
  } else {
    const rows: Installed[] = []
    for (const row of parseInstalled(listed.stdout, cwd)) {
      rows.push(await withProvides($, row))
    }
    await update($, installed, () => rows)
  }
  const mods = await listDevMods($)
  await update($, devMods, () => mods)
  const stored = offList(await $.store.get(STORE_OFF))
  await update($, off, () => stored)
  const saved = profileList(await $.store.get(STORE_PROFILES))
  await update($, profiles, () => saved)
  await update($, isLoading, () => false)
}

// Reloads the session's plugins so a switch takes effect now; what could not
// be reloaded stays listed as pending.
async function apply($: EngineInterface) {
  const ran = await $.command.run({ command: 'reload-plugins' }).catch(() => undefined)
  if (ran === undefined) {
    await update($, note, () => 'Mudança salva, mas não consegui recarregar daqui: rode /reload-plugins.')

    return
  }
  await update($, pending, () => [])
}

async function switchPlugin($: EngineInterface, row: Installed, isOn: boolean) {
  const ran = await claude($, [isOn ? 'enable' : 'disable', row.id, '--scope', row.scope], 60000)
  if (ran === undefined || ran.exitCode !== 0) {
    const why = ran === undefined ? 'o comando não rodou' : (ran.stderr || ran.stdout).trim().slice(0, 200)
    await update($, note, () => `Erro ao ${isOn ? 'ligar' : 'desligar'} ${row.id}: ${why}`)

    return false
  }
  await update($, pending, list => (list.includes(row.id) ? list : [...list, row.id]))

  return true
}

async function toggleInstalled($: EngineInterface, row: Installed) {
  const key = `${row.id} ${row.scope}`
  if ((await read($, busy)).includes(key)) {
    return
  }
  // Switching off a plugin with MCP servers drops their tools: asked twice.
  if (row.isEnabled && row.mcp.length > 0 && (await read($, confirm)) !== key) {
    await update($, confirm, () => key)
    await update($, note, () => `${describe(row).name} tem servidor MCP (${row.mcp.join(', ')}). Clique de novo para desligar.`)

    return
  }
  await update($, confirm, () => '')
  await update($, busy, list => [...list, key])
  const isOn = !row.isEnabled
  await update($, installed, list => list.map(one => (one.id === row.id && one.scope === row.scope ? { ...one, isEnabled: isOn } : one)))
  const hasSwitched = await switchPlugin($, row, isOn)
  await update($, busy, list => list.filter(one => one !== key))
  if (!hasSwitched) {
    await refresh($)

    return
  }
  await update($, note, () => `${describe(row).name} ${isOn ? 'ligado' : 'desligado'}.`)
  await apply($)
}

// A session mod is switched by this mod's `plugin.register` judge: the name
// joins or leaves the stored list, and saving its hooks.json again reloads it.
async function toggleDevMod($: EngineInterface, mod: DevMod) {
  const before = offList(await $.store.get(STORE_OFF))
  const isOff = before.includes(mod.name)
  const after = isOff ? before.filter(name => name !== mod.name) : [...before, mod.name]
  await $.store.set(STORE_OFF, after)
  await update($, off, () => after)
  const hooks = `${mod.root}/hooks/hooks.json`
  const text = await $.fs.read(hooks).catch(() => undefined)
  if (text !== undefined) {
    await $.fs.write(hooks, text)
  }
  await update($, note, () => `${mod.name} ${isOff ? 'ligado' : 'desligado'}; recarrega em instantes.`)
}

async function saveProfile($: EngineInterface, raw: string) {
  const name = raw.trim().slice(0, 40)
  if (name === '') {
    return
  }
  const ids = (await read($, installed)).filter(row => row.isEnabled && row.canToggle).map(row => row.id)
  const next = [...(await read($, profiles)).filter(one => one.name !== name), { name, ids }]
  await $.store.set(STORE_PROFILES, next)
  await update($, profiles, () => next)
  await update($, note, () => `Perfil "${name}" salvo com ${ids.length} plugins ligados.`)
}

async function deleteProfile($: EngineInterface, profile: Profile) {
  const next = (await read($, profiles)).filter(one => one.name !== profile.name)
  await $.store.set(STORE_PROFILES, next)
  await update($, profiles, () => next)
}

async function applyProfile($: EngineInterface, profile: Profile) {
  const changes = profileChanges(await read($, installed), profile)
  if (changes.length === 0) {
    await update($, note, () => `Perfil "${profile.name}" já está aplicado.`)

    return
  }
  await update($, isLoading, () => true)
  let done = 0
  for (const row of changes) {
    if (await switchPlugin($, row, !row.isEnabled)) {
      done += 1
    }
  }
  await refresh($)
  await update($, note, () => `Perfil "${profile.name}" aplicado: ${done} de ${changes.length} plugins alterados.`)
  await apply($)
}

async function loadCatalog($: EngineInterface) {
  await update($, isLoading, () => true)
  const listed = await claude($, ['list', '--available', '--json'], 60000)
  catalog = listed === undefined || listed.exitCode !== 0 ? [] : parseAvailable(listed.stdout)
  await update($, isCatalogLoaded, () => catalog.length > 0)
  await update($, isLoading, () => false)
  await update($, note, () =>
    catalog.length > 0
      ? `${catalog.length} plugins disponíveis: digite no filtro para buscar.`
      : 'Erro: não consegui listar os marketplaces.',
  )
}

// install, update and uninstall share a shape: run, say, re-read, reload.
async function manage($: EngineInterface, verb: 'install' | 'update' | 'uninstall', id: string, scope: string) {
  const said = { install: 'instalado', update: 'atualizado', uninstall: 'removido' }[verb]
  await update($, confirm, () => '')
  await update($, busy, list => [...list, id])
  await update($, note, () => `${verb} ${id}…`)
  const ran = await claude($, [verb, id, '--scope', scope], 300000)
  await update($, busy, list => list.filter(one => one !== id))
  if (ran === undefined || ran.exitCode !== 0) {
    const why = ran === undefined ? 'o comando não rodou' : (ran.stderr || ran.stdout).trim().slice(0, 200)
    await update($, note, () => `Erro (${verb} ${id}): ${why}`)

    return
  }
  await update($, pending, list => (list.includes(id) ? list : [...list, id]))
  await refresh($)
  await update($, note, () => `${id} ${said}.`)
  await apply($)
}

async function askRemove($: EngineInterface, row: Installed) {
  const key = `rm ${row.id}`
  if ((await read($, confirm)) !== key) {
    await update($, confirm, () => key)

    return
  }
  await manage($, 'uninstall', row.id, row.scope)
}

function flip(list: readonly string[], name: string) {
  return list.includes(name) ? list.filter(one => one !== name) : [...list, name]
}

// The two filter buttons exclude each other; pressing the lit one clears it.
function pick(now: Only, wanted: Only): Only {
  return now === wanted ? 'all' : wanted
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'mods', description: 'Ver, ligar e desligar seus mods e plugins' })
    // A reload starts the module over: rows of an older shape, work that was
    // running and the catalog it held are gone, so the state says so.
    await update($, installed, () => [])
    await update($, busy, () => [])
    await update($, confirm, () => '')
    await update($, isCatalogLoaded, () => false)
    await update($, isLoading, () => false)

    return next(e)
  })

  on('plugin.register', async ($, e, next) => {
    const folder = await sessionFolder($)
    const isSessionMod = folder !== undefined && e.root.startsWith(`${folder}/`)
    if (e.name !== $.plugin.name && isSessionMod && offList(await $.store.get(STORE_OFF)).includes(e.name)) {
      return { refuse: 'desligado em /mods' }
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'mods' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Mods', focus: true, columns: 64 })
    void refresh($)

    return { text: 'Painel de mods aberto.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const rows = await read($, installed)
    const mods = await read($, devMods)
    const offNames = await read($, off)
    const open = await read($, expanded)
    const working = await read($, busy)
    const waiting = await read($, pending)
    const saved = await read($, profiles)
    const asked = await read($, confirm)
    const wanted = await read($, query)
    const kept = await read($, only)
    const hasCatalog = await read($, isCatalogLoaded)
    const message = await read($, note)
    const loading = await read($, isLoading)

    const onCount = rows.filter(row => row.isEnabled).length + mods.filter(mod => !offNames.includes(mod.name)).length
    const shown = rows.filter(row => matches(wanted, row.id, row.description) && passes(kept, row.isEnabled))
    const shownMods = mods.filter(mod => matches(wanted, mod.name, mod.description) && passes(kept, !offNames.includes(mod.name)))
    const have = new Set(rows.map(row => row.id))
    const offers =
      hasCatalog && wanted.trim().length >= 2
        ? catalog.filter(one => !have.has(one.id) && matches(wanted, one.name, one.description)).slice(0, MAX_OFFERS)
        : []
    const isError = message.startsWith('Erro')
    const toggle = (key: string, look: SwitchLook, onPress: () => void) => {
      const label = look === 'busy' ? SWITCH_BUSY : look === 'on' ? SWITCH_ON : SWITCH_OFF
      if (look === 'busy') {
        return <Button key={key} label={label} onPress={onPress} />
      }

      return (
        <Button key={key} label={label} onPress={onPress}>
          <Text color={look === 'on' ? DOT_ON : DOT_OFF}>{DOT}</Text>
          {` ${label}`}
        </Button>
      )
    }

    return (
      <Box flexDirection="column" gap={1} paddingX={1}>
        <Box flexDirection="row" justifyContent="space-between" alignItems="center">
          <Text dimColor>{loading ? 'Carregando…' : `${onCount} de ${rows.length + mods.length} ligados`}</Text>
          <Button key="refresh" label="Atualizar lista" dimColor onPress={() => void refresh($)} />
        </Box>
        {waiting.length > 0 && (
          <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap={1}>
            <Box flexShrink={1} minWidth={0}>
              <Text color="warning" wrap="wrap">
                {`Pendente de recarga: ${waiting.length}`}
              </Text>
            </Box>
            <Box flexShrink={0}>
              <Button key="reload" label="Aplicar agora" variant="primary" onPress={() => void apply($)} />
            </Box>
          </Box>
        )}
        {message !== '' && (
          <Text color={isError ? 'error' : undefined} dimColor={!isError} wrap="wrap">
            {message}
          </Text>
        )}
        {'Input' in ui && (
          <Box flexDirection="row" alignItems="center" gap={1}>
            <Box flexGrow={1} minWidth={0}>
              <ui.Input
                key="q"
                placeholder="Filtrar por nome"
                value={wanted}
                submitLabel="filtrar"
                onInput={value => void update($, query, () => value)}
                onSubmit={value => void update($, query, () => value)}
              />
            </Box>
            <Box flexDirection="row" flexShrink={0} gap={1}>
              <Button
                key="only-on"
                label="Ligados"
                variant={kept === 'on' ? 'primary' : 'secondary'}
                dimColor={kept !== 'on'}
                onPress={() => void update($, only, value => pick(value, 'on'))}
              />
              <Button
                key="only-off"
                label="Desligados"
                variant={kept === 'off' ? 'primary' : 'secondary'}
                dimColor={kept !== 'off'}
                onPress={() => void update($, only, value => pick(value, 'off'))}
              />
            </Box>
          </Box>
        )}
        {shownMods.length > 0 && (
          <Box flexDirection="column">
            <Text dimColor bold>
              MODS EM DESENVOLVIMENTO (ESTA SESSÃO)
            </Text>
            <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
              {shownMods.map(mod => {
                const isOn = !offNames.includes(mod.name)
                const isOpen = open.includes(mod.name)

                return (
                  <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap={2}>
                    <Box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0}>
                      <Text bold={isOn} dimColor={!isOn} wrap="wrap">
                        {mod.name}
                      </Text>
                      {mod.description !== '' && (
                        <Text color="subtle" wrap="wrap">
                          {isOpen ? mod.description : shorten(mod.description)}
                        </Text>
                      )}
                      {mod.description.length > SHORT && (
                        <Box flexDirection="row">
                          <Button
                            key={`more:${mod.name}`}
                            label={isOpen ? 'Ler menos' : 'Ler mais'}
                            plain
                            dimColor
                            onPress={() => void update($, expanded, list => flip(list, mod.name))}
                          />
                        </Box>
                      )}
                    </Box>
                    <Box flexShrink={0}>
                      {toggle(`mod:${mod.name}`, isOn ? 'on' : 'off', () => void toggleDevMod($, mod))}
                    </Box>
                  </Box>
                )
              })}
            </Box>
          </Box>
        )}
        <Box flexDirection="column">
          <Text dimColor bold>
            PLUGINS INSTALADOS
          </Text>
          <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
            {shown.length === 0 && <Text dimColor>{loading ? 'Carregando…' : 'Nenhum plugin encontrado.'}</Text>}
            {shown.map(row => {
              const { name, meta, full } = describe(row)
              const about = row.description === '' ? meta : shorten(row.description)
              const key = `${row.id} ${row.scope}`
              const isOpen = open.includes(key)
              const isBusy = working.includes(key) || working.includes(row.id)
              const isWaiting = waiting.includes(row.id)

              return (
                <Box flexDirection="column">
                  <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap={2}>
                    <Box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0}>
                      <Text bold={row.isEnabled} dimColor={!row.isEnabled} wrap="wrap">
                        {name}
                      </Text>
                      <Text color="subtle" wrap="wrap">
                        {isWaiting ? `${about} · pendente de recarga` : about}
                      </Text>
                    </Box>
                    <Box flexDirection="row" flexShrink={0} alignItems="center" gap={1}>
                      <Button
                        key={`more:${key}`}
                        label={isOpen ? 'Ocultar' : 'Detalhes'}
                        plain
                        dimColor
                        onPress={() => void update($, expanded, list => flip(list, key))}
                      />
                      {row.canToggle ? (
                        asked === key && !isBusy ? (
                          <Button
                            key={`plugin:${row.id}:${row.scope}`}
                            label="Desligar?"
                            variant="primary"
                            onPress={() => void toggleInstalled($, row)}
                          />
                        ) : (
                          toggle(`plugin:${row.id}:${row.scope}`, isBusy ? 'busy' : row.isEnabled ? 'on' : 'off', () => void toggleInstalled($, row))
                        )
                      ) : (
                        <Text dimColor>{row.isEnabled ? 'ligado · gerenciado' : 'desligado · gerenciado'}</Text>
                      )}
                    </Box>
                  </Box>
                  {isOpen && (
                    <Box flexDirection="column" paddingLeft={2} marginBottom={1}>
                      {row.description.length > SHORT && (
                        <Text dimColor wrap="wrap">
                          {row.description}
                        </Text>
                      )}
                      <Text dimColor wrap="wrap">
                        {full}
                      </Text>
                      <Text dimColor wrap="wrap">{`Traz: ${row.provides}`}</Text>
                      {row.installPath !== '' && (
                        <Text dimColor wrap="wrap">
                          {row.installPath}
                        </Text>
                      )}
                      {row.canToggle && (
                        <Box flexDirection="row" gap={1}>
                          <Button
                            key={`update:${key}`}
                            label="Atualizar"
                            dimColor
                            onPress={() => void manage($, 'update', row.id, row.scope)}
                          />
                          <Button
                            key={`remove:${key}`}
                            label={asked === `rm ${row.id}` ? 'Confirmar remoção' : 'Remover'}
                            dimColor
                            onPress={() => void askRemove($, row)}
                          />
                        </Box>
                      )}
                    </Box>
                  )}
                </Box>
              )
            })}
          </Box>
        </Box>
        <Box flexDirection="column">
          <Text dimColor bold>
            PERFIS
          </Text>
          <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
            {saved.length === 0 && (
              <Text dimColor wrap="wrap">
                Um perfil guarda quais plugins estão ligados agora, para você voltar a esse conjunto com um clique.
              </Text>
            )}
            {saved.map(profile => (
              <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap={2}>
                <Box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0}>
                  <Text bold wrap="wrap">
                    {profile.name}
                  </Text>
                  <Text dimColor>{`${profile.ids.length} plugins ligados`}</Text>
                </Box>
                <Box flexDirection="row" flexShrink={0} gap={1}>
                  <Button key={`use:${profile.name}`} label="Aplicar" onPress={() => void applyProfile($, profile)} />
                  <Button key={`del:${profile.name}`} label="Excluir" dimColor onPress={() => void deleteProfile($, profile)} />
                </Box>
              </Box>
            ))}
            {'Input' in ui && (
              <ui.Input
                key={`profile-${saved.length}`}
                placeholder="Nome para salvar o conjunto atual"
                submitLabel="salvar"
                onSubmit={value => void saveProfile($, value)}
              />
            )}
          </Box>
        </Box>
        <Box flexDirection="column">
          <Text dimColor bold>
            INSTALAR NOVOS
          </Text>
          <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
            {!hasCatalog && (
              <Box flexDirection="row">
                <Button key="catalog" label="Buscar nos marketplaces" onPress={() => void loadCatalog($)} />
              </Box>
            )}
            {hasCatalog && offers.length === 0 && (
              <Text dimColor wrap="wrap">
                {wanted.trim().length >= 2 ? 'Nada encontrado para esse filtro.' : 'Digite ao menos 2 letras no filtro acima.'}
              </Text>
            )}
            {offers.map(one => (
              <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap={2}>
                <Box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0}>
                  <Text bold wrap="wrap">
                    {one.id}
                  </Text>
                  <Text color="subtle" wrap="wrap">
                    {shorten(one.description)}
                  </Text>
                </Box>
                <Box flexShrink={0}>
                  <Button
                    key={`install:${one.id}`}
                    label={working.includes(one.id) ? SWITCH_BUSY : 'Instalar'}
                    onPress={() => void manage($, 'install', one.id, 'user')}
                  />
                </Box>
              </Box>
            ))}
          </Box>
        </Box>
      </Box>
    )
  })
}
