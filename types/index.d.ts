export type Installed = {
  id: string
  scope: string
  version: string
  isEnabled: boolean
  canToggle: boolean
  installPath: string
  mcp: string[]
  provides: string
  description: string
}

export type DevMod = { name: string; root: string; description: string }

export type Profile = { name: string; ids: string[] }

export type Only = 'all' | 'on' | 'off'

declare module 'claude-code' {
  interface PluginState {
    'mods-manager': {
      installed: Installed[]
      devMods: DevMod[]
      off: string[]
      expanded: string[]
      busy: string[]
      pending: string[]
      profiles: Profile[]
      confirm: string
      query: string
      only: Only
      isCatalogLoaded: boolean
      note: string
      isLoading: boolean
    }
  }
}
