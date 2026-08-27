import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import {
  getMaxProjectorDistance,
  getMirrorCenter,
  getMirrorFrontY,
  getProjectorCenter,
  halfAnglesFromDiagonalFov,
  isMirrorOpticalSurface,
  PROJECTOR_HALF_SIZE,
  projectorRayDirection,
  raySphereDistance,
  reflect,
  traceProjection,
  verticalFovToDiagonal,
} from './rayTracer'
import type { SimulationParameters } from './types'

const defaults: SimulationParameters = {
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
    const domeRadius = defaults.domeDiameter * 0.5
    const mirrorRadius = defaults.mirrorDiameter * 0.5
    const maxHeight = domeRadius - mirrorRadius

    for (const mirrorHeight of [0, 1.15, 3, 12]) {
      const centre = getMirrorCenter({ ...defaults, mirrorHeight })
      const contact = centre
        .clone()
        .add(new Vector3(0, 0, mirrorRadius))

      expect(centre.x).toBe(0)
      expect(centre.y).toBeLessThanOrEqual(0)
      expect(centre.z).toBeCloseTo(Math.min(mirrorHeight, maxHeight))
      expect(contact.length()).toBeCloseTo(domeRadius)
    }
  })

  it('never lets any part of the mirror body pass through the dome', () => {
    for (const mirrorHeight of [0, 0.8, 2.4, 4]) {
      const params = { ...defaults, mirrorHeight }
      const centre = getMirrorCenter(params)
      const domeRadius = params.domeDiameter * 0.5
      const mirrorRadius = params.mirrorDiameter * 0.5

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
            ).multiplyScalar(mirrorRadius),
          )

          expect(surfacePoint.length()).toBeLessThanOrEqual(domeRadius + 1e-6)
        }
      }
    }
  })

  it('places the projector by front-to-front mirror distance', () => {
    const mirror = getMirrorCenter(defaults)
    const projector = getProjectorCenter(defaults)
    const mirrorFrontY = mirror.y + defaults.mirrorDiameter * 0.5
    const projectorFrontY = projector.y - PROJECTOR_HALF_SIZE.y

    expect(projector.x).toBe(0)
    expect(projectorFrontY).toBeCloseTo(mirrorFrontY + defaults.projectorDistance)
    expect(projector.z).toBeCloseTo(defaults.projectorHeight)
  })

  it('lets the projector touch the mirror and reach the dome mid-plane', () => {
    const touching = getProjectorCenter({ ...defaults, projectorDistance: 0 })
    expect(touching.y - PROJECTOR_HALF_SIZE.y).toBeCloseTo(
      getMirrorFrontY(defaults),
    )

    const maxDistance = getMaxProjectorDistance(defaults)
    const atCentre = getProjectorCenter({
      ...defaults,
      projectorDistance: maxDistance,
    })
    expect(atCentre.y - PROJECTOR_HALF_SIZE.y).toBeCloseTo(0)
    expect(maxDistance).toBeGreaterThan(0)
  })

  it('accepts lower optical-face hits when the mirror is pitched down', () => {
    const upright = isMirrorOpticalSurface(new Vector3(0, 0.2, -0.1).normalize(), defaults)
    const pitched = isMirrorOpticalSurface(new Vector3(0, 0.2, -0.1).normalize(), {
      ...defaults,
      mirrorPitch: 35,
    })

    expect(upright).toBe(false)
    expect(pitched).toBe(true)
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

  it('raises the image when vertical lens shift is applied', () => {
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

  it('keeps the optical axis fixed regardless of lens shift and FOV', () => {
    const shift = {
      ...defaults,
      lensShiftVertical: 0.75,
    }
    const opticalU = -shift.lensShiftHorizontal * 2
    const opticalV = -shift.lensShiftVertical * 2
    const narrow = projectorRayDirection(opticalU, opticalV, {
      ...shift,
      projectorFov: 30,
    })
    const wide = projectorRayDirection(opticalU, opticalV, {
      ...shift,
      projectorFov: 90,
    })

    expect(narrow.x).toBeCloseTo(0)
    expect(narrow.y).toBeCloseTo(-1, 5)
    expect(narrow.z).toBeCloseTo(0)
    expect(wide.x).toBeCloseTo(narrow.x)
    expect(wide.y).toBeCloseTo(narrow.y)
    expect(wide.z).toBeCloseTo(narrow.z)
  })

  it('translates the image in parallel by up to one beam height', () => {
    const { verticalHalf } = halfAnglesFromDiagonalFov(
      defaults.projectorFov,
      defaults.aspectRatio,
    )
    const verticalScale = Math.tan(verticalHalf)

    const unshiftedTop = projectorRayDirection(0, 1, defaults)
    const halfShiftCentre = projectorRayDirection(0, 0, {
      ...defaults,
      lensShiftVertical: 0.5,
    })
    const fullShiftBottom = projectorRayDirection(0, -1, {
      ...defaults,
      lensShiftVertical: 1,
    })

    expect(halfShiftCentre.x).toBeCloseTo(unshiftedTop.x)
    expect(halfShiftCentre.y).toBeCloseTo(unshiftedTop.y)
    expect(halfShiftCentre.z).toBeCloseTo(unshiftedTop.z)

    expect(fullShiftBottom.x).toBeCloseTo(unshiftedTop.x)
    expect(fullShiftBottom.y).toBeCloseTo(unshiftedTop.y)
    expect(fullShiftBottom.z).toBeCloseTo(unshiftedTop.z)

    const shiftedCentre = projectorRayDirection(0, 0, {
      ...defaults,
      lensShiftVertical: 1,
    })
    expect(shiftedCentre.z).toBeCloseTo(
      (2 * verticalScale) / Math.sqrt(1 + (2 * verticalScale) ** 2),
    )
  })

  it('widens the beam around the optical axis when diagonal FOV increases', () => {
    const corner = projectorRayDirection(1, 1, {
      ...defaults,
      projectorFov: 30,
    })
    const widerCorner = projectorRayDirection(1, 1, {
      ...defaults,
      projectorFov: 90,
    })
    const axis = projectorRayDirection(0, 0, defaults)

    const angleFromAxis = (dir: Vector3) =>
      Math.acos(Math.min(1, Math.max(-1, dir.dot(axis))))

    expect(angleFromAxis(widerCorner)).toBeGreaterThan(angleFromAxis(corner))
  })
})

describe('diagonal FOV', () => {
  it('matches vertical FOV at the image centre for zero lens shift', () => {
    const verticalFov = 28
    const diagonalFov = verticalFovToDiagonal(verticalFov, '16:9')
    const { verticalHalf } = halfAnglesFromDiagonalFov(diagonalFov, '16:9')
    expect((verticalHalf * 360) / Math.PI).toBeCloseTo(verticalFov)
  })

  it('places the corner ray on the diagonal half-angle', () => {
    const diagonalFov = 54
    const { horizontalHalf, verticalHalf } = halfAnglesFromDiagonalFov(
      diagonalFov,
      '16:9',
    )
    const corner = projectorRayDirection(1, -1, {
      ...defaults,
      projectorFov: diagonalFov,
    })
    const axis = projectorRayDirection(0, 0, {
      ...defaults,
      projectorFov: diagonalFov,
    })
    const cornerAngle = Math.acos(Math.min(1, Math.max(-1, corner.dot(axis))))
    const expectedHalf = Math.atan(
      Math.sqrt(
        Math.tan(horizontalHalf) ** 2 + Math.tan(verticalHalf) ** 2,
      ),
    )
    expect(cornerAngle).toBeCloseTo(expectedHalf)
  })
})
