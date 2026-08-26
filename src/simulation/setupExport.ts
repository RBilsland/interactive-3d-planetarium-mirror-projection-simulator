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
  display: Pick<DisplayOptions, 'includeOccludedInMesh'>
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
      includeOccludedInMesh: display.includeOccludedInMesh,
    },
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
