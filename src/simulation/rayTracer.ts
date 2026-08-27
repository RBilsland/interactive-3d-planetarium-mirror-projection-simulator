import { Euler, Vector3 } from 'three'
import type {
  GridBounds,
  SimulationParameters,
  TraceResult,
  TracedRay,
} from './types'

const EPSILON = 1e-5
/** Chassis half-extents in meters. Y is depth; the lens face points toward −Y. */
export const PROJECTOR_HALF_SIZE = new Vector3(0.24, 0.34, 0.13)

// Clearance is only meaningful near the chassis; beyond this the beam is simply free.
const MAX_REPORTED_CLEARANCE = 2

export function aspectRatioValue(aspectRatio: string): number {
  const [width, height] = aspectRatio.split(':').map(Number)
  return width / height
}

/** Half-angles (radians) for horizontal and vertical edges from diagonal FOV. */
export function halfAnglesFromDiagonalFov(
  diagonalFovDegrees: number,
  aspectRatio: string,
): { horizontalHalf: number; verticalHalf: number } {
  const aspect = aspectRatioValue(aspectRatio)
  const diagonalHalf = (diagonalFovDegrees * Math.PI) / 360
  const tanDiagonal = Math.tan(diagonalHalf)
  const scale = Math.sqrt(1 + aspect * aspect)
  return {
    verticalHalf: Math.atan(tanDiagonal / scale),
    horizontalHalf: Math.atan((tanDiagonal * aspect) / scale),
  }
}

/** Convert legacy vertical FOV (degrees) to equivalent diagonal FOV. */
export function verticalFovToDiagonal(
  verticalFovDegrees: number,
  aspectRatio: string,
): number {
  const aspect = aspectRatioValue(aspectRatio)
  const verticalHalf = (verticalFovDegrees * Math.PI) / 360
  const diagonalHalf = Math.atan(
    Math.tan(verticalHalf) * Math.sqrt(1 + aspect * aspect),
  )
  return (diagonalHalf * 360) / Math.PI
}

/**
 * Unit direction for a normalised projector pixel (u,v in [-1,1]).
 * Rays pass through a plane perpendicular to the optical axis (−Y). Lens shift
 * translates that image on the plane (±1 = one full image height/width); FOV
 * only sets the plane extent — the optical axis itself never tilts with shift.
 */
export function projectorRayDirection(
  u: number,
  v: number,
  params: SimulationParameters,
): Vector3 {
  const { horizontalHalf, verticalHalf } = halfAnglesFromDiagonalFov(
    params.projectorFov,
    params.aspectRatio,
  )
  const horizontalScale = Math.tan(horizontalHalf)
  const verticalScale = Math.tan(verticalHalf)

  const planeX =
    params.lensShiftHorizontal * 2 * horizontalScale + u * horizontalScale
  const planeZ =
    params.lensShiftVertical * 2 * verticalScale + v * verticalScale

  return new Vector3(planeX, -1, planeZ).normalize()
}

// The mirror is a quarter sphere, so its rear face is flat and its point furthest
// from the dome centre is the top of that face, at `mirrorHeight + mirrorRadius`.
// Pushing the mirror back until that point lands on the shell keeps it in contact
// with the dome at any height without letting the body poke through.
export function getDomeRadius(params: SimulationParameters): number {
  return params.domeDiameter * 0.5
}

export function getMirrorRadius(params: SimulationParameters): number {
  return params.mirrorDiameter * 0.5
}

export function getMirrorCenter(params: SimulationParameters): Vector3 {
  const domeRadius = getDomeRadius(params)
  const mirrorRadius = getMirrorRadius(params)
  const maxHeight = Math.max(0, domeRadius - mirrorRadius)
  const height = Math.min(params.mirrorHeight, maxHeight)
  const contactHeight = height + mirrorRadius

  return new Vector3(
    0,
    -Math.sqrt(Math.max(0, domeRadius ** 2 - contactHeight ** 2)),
    height,
  )
}

/**
 * World rotation of the mirror mesh. Positive `mirrorPitch` tips the optical
 * face downward (toward a lower projector) around local +X.
 */
export function getMirrorRotation(params: SimulationParameters): Euler {
  return new Euler((-params.mirrorPitch * Math.PI) / 180, 0, 0, 'XYZ')
}

/** True when a sphere-surface normal lies on the retained optical quarter. */
export function isMirrorOpticalSurface(
  worldNormal: Vector3,
  params: SimulationParameters,
): boolean {
  // Inverse of getMirrorRotation: undo the pitch-down tip before the quarter test.
  const localNormal = worldNormal
    .clone()
    .applyEuler(new Euler((params.mirrorPitch * Math.PI) / 180, 0, 0, 'XYZ'))
  return localNormal.y >= -EPSILON && localNormal.z >= -EPSILON
}

/** +Y extremity of the optical surface (dome-facing front of the mirror). */
export function getMirrorFrontY(params: SimulationParameters): number {
  return getMirrorCenter(params).y + getMirrorRadius(params)
}

/**
 * Largest front-to-front throw that still keeps the projector front at or behind
 * the dome mid-plane (`Y = 0`).
 */
export function getMaxProjectorDistance(params: SimulationParameters): number {
  return Math.max(0, -getMirrorFrontY(params))
}

/**
 * Places the projector so `projectorDistance` is the gap from the front of the
 * mirror to the front of the chassis (lens face). `0` means they touch; the
 * upper limit is the dome centre line.
 */
export function getProjectorCenter(params: SimulationParameters): Vector3 {
  const distance = Math.min(
    Math.max(0, params.projectorDistance),
    getMaxProjectorDistance(params),
  )
  return new Vector3(
    0,
    getMirrorFrontY(params) + distance + PROJECTOR_HALF_SIZE.y,
    params.projectorHeight,
  )
}

export function raySphereDistance(
  origin: Vector3,
  direction: Vector3,
  center: Vector3,
  radius: number,
): number | null {
  const offset = origin.clone().sub(center)
  const b = 2 * offset.dot(direction)
  const c = offset.lengthSq() - radius * radius
  const discriminant = b * b - 4 * c

  if (discriminant < 0) return null

  const root = Math.sqrt(discriminant)
  const near = (-b - root) / 2
  const far = (-b + root) / 2

  if (near > EPSILON) return near
  if (far > EPSILON) return far
  return null
}

export function reflect(direction: Vector3, normal: Vector3): Vector3 {
  return direction
    .clone()
    .sub(normal.clone().multiplyScalar(2 * direction.dot(normal)))
    .normalize()
}

function rayIntersectsProjector(
  origin: Vector3,
  direction: Vector3,
  maxDistance: number,
  center: Vector3,
  pitchRadians: number,
): boolean {
  const inverseRotation = new Euler(-pitchRadians, 0, 0, 'XYZ')
  const localOrigin = origin.clone().sub(center).applyEuler(inverseRotation)
  const localDirection = direction.clone().applyEuler(inverseRotation)
  let tMin = 0
  let tMax = maxDistance

  for (const axis of ['x', 'y', 'z'] as const) {
    const component = localDirection[axis]
    const start = localOrigin[axis]
    const halfSize = PROJECTOR_HALF_SIZE[axis]

    if (Math.abs(component) < EPSILON) {
      if (start < -halfSize || start > halfSize) return false
      continue
    }

    let near = (-halfSize - start) / component
    let far = (halfSize - start) / component
    if (near > far) [near, far] = [far, near]
    tMin = Math.max(tMin, near)
    tMax = Math.min(tMax, far)
    if (tMin > tMax) return false
  }

  return tMax > EPSILON && tMin < maxDistance
}

/**
 * Vertical gap between the reflected beam and the top of the projector chassis,
 * measured only where the beam crosses the chassis footprint in plan view.
 * Positive means the beam passes over the projector, which is what keeps the
 * hardware out of the picture; negative means the beam passes level with or
 * below it. The rotated chassis is treated as its world-aligned bounding box.
 */
function beamClearanceOverProjector(
  rays: TracedRay[],
  center: Vector3,
  pitchRadians: number,
): number {
  const pitchCos = Math.abs(Math.cos(pitchRadians))
  const pitchSin = Math.abs(Math.sin(pitchRadians))
  const halfY =
    pitchCos * PROJECTOR_HALF_SIZE.y + pitchSin * PROJECTOR_HALF_SIZE.z
  const halfZ =
    pitchSin * PROJECTOR_HALF_SIZE.y + pitchCos * PROJECTOR_HALF_SIZE.z
  const topZ = center.z + halfZ
  let clearance = MAX_REPORTED_CLEARANCE

  for (const ray of rays) {
    if (!ray.mirrorHit || !ray.domeHit) continue

    const start = ray.mirrorHit
    const delta = ray.domeHit.clone().sub(start)
    let tMin = 0
    let tMax = 1

    const footprint = [
      { from: start.x, step: delta.x, low: center.x - PROJECTOR_HALF_SIZE.x, high: center.x + PROJECTOR_HALF_SIZE.x },
      { from: start.y, step: delta.y, low: center.y - halfY, high: center.y + halfY },
    ]
    let crosses = true

    for (const axis of footprint) {
      if (Math.abs(axis.step) < EPSILON) {
        if (axis.from < axis.low || axis.from > axis.high) crosses = false
        continue
      }

      let near = (axis.low - axis.from) / axis.step
      let far = (axis.high - axis.from) / axis.step
      if (near > far) [near, far] = [far, near]
      tMin = Math.max(tMin, near)
      tMax = Math.min(tMax, far)
      if (tMin > tMax) crosses = false
    }

    if (!crosses) continue

    // Height varies linearly along the segment, so the extremes are the endpoints.
    clearance = Math.min(
      clearance,
      start.z + tMin * delta.z - topZ,
      start.z + tMax * delta.z - topZ,
    )
  }

  return clearance
}

function sphericalTriangleArea(
  pointA: Vector3,
  pointB: Vector3,
  pointC: Vector3,
  center: Vector3,
  radius: number,
): number {
  const a = pointA.clone().sub(center).normalize()
  const b = pointB.clone().sub(center).normalize()
  const c = pointC.clone().sub(center).normalize()
  const determinant = Math.abs(a.dot(b.clone().cross(c)))
  const denominator = 1 + a.dot(b) + b.dot(c) + c.dot(a)
  return 2 * Math.atan2(determinant, Math.max(EPSILON, denominator)) * radius ** 2
}

function litPatchArea(
  rays: TracedRay[],
  getHit: (ray: TracedRay | undefined) => Vector3 | null,
  center: Vector3,
  radius: number,
  params: SimulationParameters,
): number {
  const byGrid = new Map(rays.map((ray) => [`${ray.column}:${ray.row}`, ray]))
  let area = 0

  for (let row = 0; row < params.gridRows - 1; row += 1) {
    for (let column = 0; column < params.gridColumns - 1; column += 1) {
      const topLeft = getHit(byGrid.get(`${column}:${row}`))
      const topRight = getHit(byGrid.get(`${column + 1}:${row}`))
      const bottomLeft = getHit(byGrid.get(`${column}:${row + 1}`))
      const bottomRight = getHit(byGrid.get(`${column + 1}:${row + 1}`))

      if (topLeft && topRight && bottomLeft && bottomRight) {
        area += sphericalTriangleArea(
          topLeft,
          topRight,
          bottomRight,
          center,
          radius,
        )
        area += sphericalTriangleArea(
          topLeft,
          bottomRight,
          bottomLeft,
          center,
          radius,
        )
      }
    }
  }

  return area
}

function calculateCoverage(rays: TracedRay[], params: SimulationParameters): number {
  const domeRadius = getDomeRadius(params)
  const coveredArea = litPatchArea(
    rays,
    (ray) => ray?.domeHit ?? null,
    new Vector3(),
    domeRadius,
    params,
  )
  const hemisphereArea = 2 * Math.PI * domeRadius ** 2
  return Math.min(100, (coveredArea / hemisphereArea) * 100)
}

function calculateMirrorUse(
  rays: TracedRay[],
  params: SimulationParameters,
  mirrorCenter: Vector3,
): number {
  const mirrorRadius = getMirrorRadius(params)
  const litArea = litPatchArea(
    rays,
    (ray) => ray?.mirrorHit ?? null,
    mirrorCenter,
    mirrorRadius,
    params,
  )
  // Optical surface is the +Y, +Z quarter of the sphere.
  const quarterSphereArea = Math.PI * mirrorRadius ** 2
  return Math.min(100, (litArea / quarterSphereArea) * 100)
}

export interface TraceOptions {
  gridBounds?: GridBounds
}

export function traceProjection(
  params: SimulationParameters,
  options: TraceOptions = {},
): TraceResult {
  const rays: TracedRay[] = []
  const mirrorCenter = getMirrorCenter(params)
  const projectorCenter = getProjectorCenter(params)
  const pitchRadians = (params.projectorPitch * Math.PI) / 180
  const pitchRotation = new Euler(pitchRadians, 0, 0, 'XYZ')
  const rowStart = options.gridBounds?.minRow ?? 0
  const rowEnd = options.gridBounds?.maxRow ?? params.gridRows - 1
  const columnStart = options.gridBounds?.minColumn ?? 0
  const columnEnd = options.gridBounds?.maxColumn ?? params.gridColumns - 1

  for (let row = rowStart; row <= rowEnd; row += 1) {
    const v = 1 - (row / (params.gridRows - 1)) * 2

    for (let column = columnStart; column <= columnEnd; column += 1) {
      const u = (column / (params.gridColumns - 1)) * 2 - 1
      const direction = projectorRayDirection(u, v, params)
        .applyEuler(pitchRotation)
        .normalize()

      const ray: TracedRay = {
        column,
        row,
        origin: projectorCenter.clone(),
        direction,
        mirrorHit: null,
        domeHit: null,
        reflectedDirection: null,
        status: 'overshot',
      }

      const mirrorDistance = raySphereDistance(
        projectorCenter,
        direction,
        mirrorCenter,
        getMirrorRadius(params),
      )

      if (mirrorDistance === null) {
        rays.push(ray)
        continue
      }

      const mirrorHit = projectorCenter
        .clone()
        .addScaledVector(direction, mirrorDistance)
      const mirrorNormal = mirrorHit.clone().sub(mirrorCenter).normalize()

      // Quarter-sphere optical face, pitched with the mirror mesh.
      if (!isMirrorOpticalSurface(mirrorNormal, params)) {
        rays.push(ray)
        continue
      }

      const reflectedDirection = reflect(direction, mirrorNormal)
      ray.mirrorHit = mirrorHit
      ray.reflectedDirection = reflectedDirection

      const domeDistance = raySphereDistance(
        mirrorHit.clone().addScaledVector(reflectedDirection, EPSILON * 2),
        reflectedDirection,
        new Vector3(),
        getDomeRadius(params),
      )

      if (domeDistance === null) {
        rays.push(ray)
        continue
      }

      const domeHit = mirrorHit
        .clone()
        .addScaledVector(reflectedDirection, domeDistance)
      if (domeHit.z < 0) {
        rays.push(ray)
        continue
      }

      ray.domeHit = domeHit
      const occluded = rayIntersectsProjector(
        mirrorHit,
        reflectedDirection,
        domeDistance,
        projectorCenter,
        pitchRadians,
      )
      ray.status = occluded ? 'occluded' : 'valid'
      rays.push(ray)
    }
  }

  const occludedCount = rays.filter((ray) => ray.status === 'occluded').length
  const validCount = rays.filter((ray) => ray.status === 'valid').length
  const missedCount = rays.length - validCount - occludedCount
  const mirrorHitCount = rays.filter((ray) => ray.mirrorHit !== null).length

  return {
    rays,
    coveragePercent: calculateCoverage(rays, params),
    mirrorHitPercent: rays.length === 0 ? 0 : (mirrorHitCount / rays.length) * 100,
    mirrorUsePercent: calculateMirrorUse(rays, params, mirrorCenter),
    mirrorHitCount,
    shadowOccluded: occludedCount > 0,
    validCount,
    missedCount,
    occludedCount,
    occludedPercent: rays.length === 0 ? 0 : (occludedCount / rays.length) * 100,
    beamClearance: beamClearanceOverProjector(
      rays,
      projectorCenter,
      pitchRadians,
    ),
  }
}
