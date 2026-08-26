import type {
  AspectRatio,
  DisplayOptions,
  SimulationParameters,
  SourceOrientation,
} from './types'

export const PROFILE_STORAGE_KEY = 'domecast.profiles.v1'

export interface SavedProfile {
  id: string
  name: string
  savedAt: number
  parameters: SimulationParameters
  display: DisplayOptions
  orientation: SourceOrientation
}

export interface ProfileStore {
  list(): SavedProfile[]
  save(
    name: string,
    parameters: SimulationParameters,
    display: DisplayOptions,
    orientation?: SourceOrientation,
  ): SavedProfile
  load(id: string): SavedProfile | null
  remove(id: string): boolean
}

const ASPECT_RATIOS: AspectRatio[] = ['16:9', '16:10', '4:3']

const DEFAULT_PARAMETERS: SimulationParameters = {
  domeRadius: 5,
  mirrorRadius: 0.65,
  mirrorHeight: 1.15,
  projectorDistance: 1.5,
  projectorHeight: 1.15,
  projectorPitch: 0,
  lensShiftVertical: 0,
  lensShiftHorizontal: 0,
  projectorFov: 28,
  aspectRatio: '16:9',
  gridColumns: 32,
  gridRows: 18,
}

const DEFAULT_DISPLAY: DisplayOptions = {
  showRays: true,
  showProjector: true,
  showPixelGrid: true,
  showGround: true,
  showSourcePreview: true,
  includeOccludedInMesh: false,
}

const DEFAULT_ORIENTATION: SourceOrientation = {
  yaw: 0,
  pitch: 0,
  roll: 0,
}

export class MemoryStorage implements Storage {
  private readonly data = new Map<string, string>()

  get length(): number {
    return this.data.size
  }

  clear(): void {
    this.data.clear()
  }

  getItem(key: string): string | null {
    return this.data.has(key) ? this.data.get(key)! : null
  }

  key(index: number): string | null {
    return [...this.data.keys()][index] ?? null
  }

  removeItem(key: string): void {
    this.data.delete(key)
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value)
  }
}

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function boolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function sanitizeParameters(raw: unknown): SimulationParameters {
  const source = (raw ?? {}) as Partial<SimulationParameters>
  const aspectRatio = ASPECT_RATIOS.includes(source.aspectRatio as AspectRatio)
    ? (source.aspectRatio as AspectRatio)
    : DEFAULT_PARAMETERS.aspectRatio

  return {
    domeRadius: finite(source.domeRadius, DEFAULT_PARAMETERS.domeRadius),
    mirrorRadius: finite(source.mirrorRadius, DEFAULT_PARAMETERS.mirrorRadius),
    mirrorHeight: finite(source.mirrorHeight, DEFAULT_PARAMETERS.mirrorHeight),
    projectorDistance: finite(
      source.projectorDistance,
      DEFAULT_PARAMETERS.projectorDistance,
    ),
    projectorHeight: finite(
      source.projectorHeight,
      DEFAULT_PARAMETERS.projectorHeight,
    ),
    projectorPitch: finite(
      source.projectorPitch,
      DEFAULT_PARAMETERS.projectorPitch,
    ),
    lensShiftVertical: finite(
      source.lensShiftVertical,
      DEFAULT_PARAMETERS.lensShiftVertical,
    ),
    lensShiftHorizontal: 0,
    projectorFov: finite(source.projectorFov, DEFAULT_PARAMETERS.projectorFov),
    aspectRatio,
    gridColumns: Math.max(
      2,
      Math.round(finite(source.gridColumns, DEFAULT_PARAMETERS.gridColumns)),
    ),
    gridRows: Math.max(
      2,
      Math.round(finite(source.gridRows, DEFAULT_PARAMETERS.gridRows)),
    ),
  }
}

function sanitizeDisplay(raw: unknown): DisplayOptions {
  const source = (raw ?? {}) as Partial<DisplayOptions>
  return {
    showRays: boolean(source.showRays, DEFAULT_DISPLAY.showRays),
    showProjector: boolean(source.showProjector, DEFAULT_DISPLAY.showProjector),
    showPixelGrid: boolean(source.showPixelGrid, DEFAULT_DISPLAY.showPixelGrid),
    showGround: boolean(source.showGround, DEFAULT_DISPLAY.showGround),
    showSourcePreview: boolean(
      source.showSourcePreview,
      DEFAULT_DISPLAY.showSourcePreview,
    ),
    includeOccludedInMesh: boolean(
      source.includeOccludedInMesh,
      DEFAULT_DISPLAY.includeOccludedInMesh,
    ),
  }
}

function sanitizeOrientation(raw: unknown): SourceOrientation {
  const source = (raw ?? {}) as Partial<SourceOrientation>
  return {
    yaw: finite(source.yaw, DEFAULT_ORIENTATION.yaw),
    pitch: finite(source.pitch, DEFAULT_ORIENTATION.pitch),
    roll: finite(source.roll, DEFAULT_ORIENTATION.roll),
  }
}

function sanitizeProfile(raw: unknown): SavedProfile | null {
  if (!raw || typeof raw !== 'object') return null
  const source = raw as Partial<SavedProfile>
  if (typeof source.id !== 'string' || source.id.length === 0) return null
  if (typeof source.name !== 'string' || source.name.trim().length === 0) {
    return null
  }

  return {
    id: source.id,
    name: source.name.trim(),
    savedAt: finite(source.savedAt, Date.now()),
    parameters: sanitizeParameters(source.parameters),
    display: sanitizeDisplay(source.display),
    orientation: sanitizeOrientation(source.orientation),
  }
}

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `profile-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function createProfileStore(
  storage: Storage = window.localStorage,
): ProfileStore {
  const read = (): SavedProfile[] => {
    try {
      const encoded = storage.getItem(PROFILE_STORAGE_KEY)
      if (!encoded) return []
      const parsed = JSON.parse(encoded) as unknown
      if (!Array.isArray(parsed)) return []
      return parsed
        .map(sanitizeProfile)
        .filter((profile): profile is SavedProfile => profile !== null)
        .sort((a, b) => b.savedAt - a.savedAt)
    } catch {
      return []
    }
  }

  const write = (profiles: SavedProfile[]): void => {
    try {
      storage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profiles))
    } catch {
      throw new Error('The browser could not store that setup.')
    }
  }

  return {
    list: read,

    save(name, parameters, display, orientation = DEFAULT_ORIENTATION) {
      const trimmed = name.trim()
      if (trimmed.length === 0) {
        throw new Error('A profile name is required')
      }

      const profiles = read()
      const existing = profiles.find(
        (profile) => profile.name.toLowerCase() === trimmed.toLowerCase(),
      )
      const saved: SavedProfile = {
        id: existing?.id ?? newId(),
        name: trimmed,
        savedAt: Date.now(),
        parameters: sanitizeParameters(parameters),
        display: sanitizeDisplay(display),
        orientation: sanitizeOrientation(orientation),
      }

      write([saved, ...profiles.filter((profile) => profile.id !== saved.id)])
      return saved
    },

    load(id) {
      return read().find((profile) => profile.id === id) ?? null
    },

    remove(id) {
      const profiles = read()
      const next = profiles.filter((profile) => profile.id !== id)
      if (next.length === profiles.length) return false
      write(next)
      return true
    },
  }
}
