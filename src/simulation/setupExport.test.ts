import { describe, expect, it } from 'vitest'
import {
  buildSetupExport,
  parseSetupExport,
  sanitizeSetupFilename,
  serializeSetupExport,
  SETUP_EXPORT_FORMAT,
} from './setupExport'
import type { DisplayOptions, SimulationParameters } from './types'

const parameters: SimulationParameters = {
  domeDiameter: 10,
  mirrorDiameter: 1.3,
  mirrorHeight: 1.15,
  mirrorPitch: 0,
  projectorDistance: 0.51,
  projectorHeight: 1.15,
  projectorPitch: 0,
  lensShiftVertical: 0,
  lensShiftHorizontal: 0,
  projectorFov: 54,
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

  it('round-trips an exported setup back through the importer', () => {
    const exported = serializeSetupExport(
      buildSetupExport('Hall A', parameters, { ...display, includeOccludedInMesh: true }, {
        yaw: 12,
        pitch: -5,
        roll: 3,
      }),
    )

    const imported = parseSetupExport(exported)

    expect(imported.name).toBe('Hall A')
    expect(imported.parameters).toEqual(parameters)
    expect(imported.orientation).toEqual({ yaw: 12, pitch: -5, roll: 3 })
    expect(imported.includeOccludedInMesh).toBe(true)
  })

  it('falls back to defaults for missing or corrupt fields', () => {
    const imported = parseSetupExport(
      JSON.stringify({
        format: SETUP_EXPORT_FORMAT,
        parameters: { domeDiameter: 12, projectorFov: 'nonsense' },
      }),
    )

    expect(imported.name).toBe('Untitled setup')
    expect(imported.parameters.domeDiameter).toBe(12)
    expect(imported.parameters.projectorFov).toBe(54)
    expect(imported.orientation).toEqual({ yaw: 0, pitch: 0, roll: 0 })
    expect(imported.includeOccludedInMesh).toBe(false)
  })

  it('rejects malformed JSON and foreign files', () => {
    expect(() => parseSetupExport('{ not json')).toThrow('INVALID_SETUP_JSON')
    expect(() => parseSetupExport('"a string"')).toThrow('INVALID_SETUP_JSON')
    expect(() => parseSetupExport(JSON.stringify({ format: 'something-else' }))).toThrow(
      'UNSUPPORTED_SETUP_FORMAT',
    )
  })

  it('sanitises download filenames', () => {
    expect(sanitizeSetupFilename('Hall A')).toBe('hall_a.json')
    expect(sanitizeSetupFilename('   ')).toBe('domecast_setup.json')
  })
})
