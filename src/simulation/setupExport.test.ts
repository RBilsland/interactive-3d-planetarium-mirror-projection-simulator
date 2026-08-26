import { describe, expect, it } from 'vitest'
import {
  buildSetupExport,
  sanitizeSetupFilename,
  serializeSetupExport,
  SETUP_EXPORT_FORMAT,
} from './setupExport'
import type { DisplayOptions, SimulationParameters } from './types'

const parameters: SimulationParameters = {
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

const display: DisplayOptions = {
  showRays: true,
  showProjector: true,
  showPixelGrid: true,
  showGround: true,
  showSourcePreview: true,
  includeOccludedInMesh: false,
}

describe('setup export', () => {
  it('builds a versioned JSON payload for external runtimes', () => {
    const setup = buildSetupExport(
      'Hall A',
      parameters,
      display,
      { yaw: 12, pitch: -5, roll: 0 },
      '2026-08-26T17:00:00.000Z',
    )

    expect(setup.format).toBe(SETUP_EXPORT_FORMAT)
    expect(setup.name).toBe('Hall A')
    expect(setup.parameters).toEqual(parameters)
    expect(setup.orientation).toEqual({ yaw: 12, pitch: -5, roll: 0 })
    expect(setup.display).toEqual({ includeOccludedInMesh: false })
  })

  it('serialises valid JSON with only Metal-relevant display fields', () => {
    const text = serializeSetupExport(buildSetupExport('Test', parameters, display, {
      yaw: 0,
      pitch: 0,
      roll: 0,
    }))
    const parsed = JSON.parse(text) as Record<string, unknown>

    expect(parsed.format).toBe(SETUP_EXPORT_FORMAT)
    expect(parsed.parameters).toBeTruthy()
    expect(parsed.orientation).toBeTruthy()
    expect(parsed.display).toEqual({ includeOccludedInMesh: false })
    expect(parsed.showRays).toBeUndefined()
  })

  it('sanitises download filenames', () => {
    expect(sanitizeSetupFilename('Hall A')).toBe('hall_a.json')
    expect(sanitizeSetupFilename('   ')).toBe('domecast_setup.json')
  })
})
