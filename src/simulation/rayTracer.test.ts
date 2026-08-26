import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import {
  getMirrorCenter,
  getProjectorCenter,
  raySphereDistance,
  reflect,
  traceProjection,
} from './rayTracer'
import type { SimulationParameters } from './types'

const defaults: SimulationParameters = {
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

describe('ray geometry', () => {
  it('returns the nearest positive sphere intersection', () => {
    const distance = raySphereDistance(
      new Vector3(0, 0, 0),
      new Vector3(0, 1, 0),
      new Vector3(0, 5, 0),
      1,
    )

    expect(distance).toBeCloseTo(4)
  })

  it('reflects a center ray away from the convex mirror', () => {
    const reflected = reflect(
      new Vector3(0, -1, 0),
      new Vector3(0, 1, 0),
    )

    expect(reflected.x).toBeCloseTo(0)
    expect(reflected.y).toBeCloseTo(1)
    expect(reflected.z).toBeCloseTo(0)
  })

  it('keeps the mirror touching the dome at every height', () => {
    const maxHeight = defaults.domeRadius - defaults.mirrorRadius

    for (const mirrorHeight of [0, 1.15, 3, 12]) {
      const centre = getMirrorCenter({ ...defaults, mirrorHeight })
      const contact = centre
        .clone()
        .add(new Vector3(0, 0, defaults.mirrorRadius))

      expect(centre.x).toBe(0)
      expect(centre.y).toBeLessThanOrEqual(0)
      expect(centre.z).toBeCloseTo(Math.min(mirrorHeight, maxHeight))
      expect(contact.length()).toBeCloseTo(defaults.domeRadius)
    }
  })

  it('never lets any part of the mirror body pass through the dome', () => {
    for (const mirrorHeight of [0, 0.8, 2.4, 4]) {
      const params = { ...defaults, mirrorHeight }
      const centre = getMirrorCenter(params)

      // Sample the retained quarter: offsets with y >= 0 (dome-facing) and z >= 0.
      for (const polar of [0, 0.25, 0.5, 0.75, 1]) {
        for (const azimuth of [0, 0.25, 0.5, 0.75, 1]) {
          const theta = polar * (Math.PI / 2)
          const phi = azimuth * Math.PI
          const surfacePoint = centre.clone().add(
            new Vector3(
              Math.cos(phi) * Math.sin(theta),
              Math.sin(phi) * Math.sin(theta),
              Math.cos(theta),
            ).multiplyScalar(params.mirrorRadius),
          )

          expect(surfacePoint.length()).toBeLessThanOrEqual(
            params.domeRadius + 1e-6,
          )
        }
      }
    }
  })

  it('places the projector ahead of the mirror on the same axis', () => {
    const mirror = getMirrorCenter(defaults)
    const projector = getProjectorCenter(defaults)

    expect(projector.x).toBe(0)
    expect(projector.y).toBeCloseTo(mirror.y + defaults.projectorDistance)
    expect(projector.z).toBeCloseTo(defaults.projectorHeight)
  })
})

describe('projection trace', () => {
  it('classifies every generated pixel ray and reaches the dome', () => {
    const result = traceProjection(defaults)

    expect(result.rays).toHaveLength(32 * 18)
    expect(result.validCount + result.missedCount + result.occludedCount).toBe(
      result.rays.length,
    )
    expect(result.validCount).toBeGreaterThan(0)
    expect(result.coveragePercent).toBeGreaterThan(0)
    expect(result.coveragePercent).toBeLessThanOrEqual(100)
    expect(result.mirrorHitCount).toBeGreaterThan(0)
    expect(result.mirrorHitPercent).toBeGreaterThan(0)
    expect(result.mirrorHitPercent).toBeLessThanOrEqual(100)
    expect(result.mirrorUsePercent).toBeGreaterThan(0)
    expect(result.mirrorUsePercent).toBeLessThanOrEqual(100)
    expect(result.occludedPercent).toBeCloseTo(
      (result.occludedCount / result.rays.length) * 100,
    )
    expect(Number.isFinite(result.beamClearance)).toBe(true)
  })

  it('reports no clearance when the beam strikes the chassis', () => {
    const result = traceProjection(defaults)

    if (result.occludedCount > 0) {
      expect(result.beamClearance).toBeLessThanOrEqual(0)
    } else {
      expect(result.beamClearance).toBeGreaterThan(0)
    }
  })

  it('offsets the optical axis when lens shift is applied', () => {
    const baseline = traceProjection(defaults)
    const shifted = traceProjection({
      ...defaults,
      lensShiftVertical: 0.4,
    })
    const mid = Math.floor(defaults.gridRows / 2) * defaults.gridColumns
      + Math.floor(defaults.gridColumns / 2)

    expect(shifted.rays[mid].direction.z).toBeGreaterThan(
      baseline.rays[mid].direction.z,
    )
    expect(shifted.rays[mid].direction.x).toBeCloseTo(
      baseline.rays[mid].direction.x,
    )
  })
})
