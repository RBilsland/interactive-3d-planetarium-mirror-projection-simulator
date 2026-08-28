import {
  sanitizeDisplay,
  sanitizeOrientation,
  sanitizeParameters,
} from './profiles'
import type {
  DisplayOptions,
  SimulationParameters,
  SourceOrientation,
} from './types'

export const SETUP_EXPORT_FORMAT = 'domecast-setup-v1'

export interface SetupExport {
  format: typeof SETUP_EXPORT_FORMAT
  name: string
  exportedAt: string
  parameters: SimulationParameters
  orientation: SourceOrientation
  display: Pick<DisplayOptions, 'excludeOccludedFromMesh'>
}

export function buildSetupExport(
  name: string,
  parameters: SimulationParameters,
  display: DisplayOptions,
  orientation: SourceOrientation,
  exportedAt = new Date().toISOString(),
): SetupExport {
  return {
    format: SETUP_EXPORT_FORMAT,
    name: name.trim() || 'Untitled setup',
    exportedAt,
    parameters: { ...parameters },
    orientation: { ...orientation },
    display: {
      excludeOccludedFromMesh: display.excludeOccludedFromMesh,
    },
  }
}

export interface ImportedSetup {
  name: string
  parameters: SimulationParameters
  orientation: SourceOrientation
  excludeOccludedFromMesh: boolean
}

/**
 * Reads a previously exported setup. Values run through the same sanitisers as
 * saved profiles, so an edited or older file still yields a usable rig.
 */
export function parseSetupExport(text: string): ImportedSetup {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('INVALID_SETUP_JSON')
  }

  if (!raw || typeof raw !== 'object') throw new Error('INVALID_SETUP_JSON')

  const source = raw as Partial<SetupExport>
  if (source.format !== SETUP_EXPORT_FORMAT) {
    throw new Error('UNSUPPORTED_SETUP_FORMAT')
  }

  const name =
    typeof source.name === 'string' && source.name.trim().length > 0
      ? source.name.trim()
      : 'Untitled setup'

  return {
    name,
    parameters: sanitizeParameters(source.parameters),
    orientation: sanitizeOrientation(source.orientation),
    excludeOccludedFromMesh: sanitizeDisplay(source.display).excludeOccludedFromMesh,
  }
}

export function serializeSetupExport(setup: SetupExport): string {
  return `${JSON.stringify(setup, null, 2)}\n`
}

export function downloadSetupExport(text: string, filename = 'domecast_setup.json'): void {
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

export function sanitizeSetupFilename(name: string): string {
  const trimmed = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_')
  const cleaned = trimmed.replace(/^_+|_+$/g, '')
  return cleaned.length > 0 ? `${cleaned}.json` : 'domecast_setup.json'
}
