import { MathUtils, Vector3 } from 'three'
import type { SourceOrientation, SourceProjection } from './types'

const TWO_PI = Math.PI * 2
/** Accept 1:1 and 2:1 with a little encoder / crop slack. */
const ASPECT_TOLERANCE = 0.05

function rotateAroundX(vector: Vector3, radians: number): void {
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  const { y, z } = vector
  vector.y = cos * y - sin * z
  vector.z = sin * y + cos * z
}

function rotateAroundY(vector: Vector3, radians: number): void {
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  const { x, z } = vector
  vector.x = cos * x + sin * z
  vector.z = -sin * x + cos * z
}

function rotateAroundZ(vector: Vector3, radians: number): void {
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  const { x, y } = vector
  vector.x = cos * x - sin * y
  vector.y = sin * x + cos * y
}

function applyOrientation(
  direction: Vector3,
  orientation: SourceOrientation,
): Vector3 {
  // The convex mirror reverses handedness, so sample the source mirrored in X
  // to keep left/right correct once the beam lands on the dome.
  const rotated = direction.clone().normalize()
  rotated.x = -rotated.x
  if (
    orientation.yaw !== 0
    || orientation.pitch !== 0
    || orientation.roll !== 0
  ) {
    // Inverse of the viewer orientation: rotate the lookup direction opposite
    // the yaw/pitch/roll applied to the source.
    rotateAroundZ(rotated, -MathUtils.degToRad(orientation.yaw))
    rotateAroundX(rotated, -MathUtils.degToRad(orientation.pitch))
    rotateAroundY(rotated, -MathUtils.degToRad(orientation.roll))
  }
  return rotated
}

/**
 * Infers source layout from pixel aspect. `1:1` → hemispherical fisheye,
 * `2:1` → equirectangular; anything else is rejected.
 */
export function detectSourceProjection(
  width: number,
  height: number,
): SourceProjection | null {
  const ratio = width / Math.max(1, height)
  if (Math.abs(ratio - 1) <= ASPECT_TOLERANCE) return 'fisheye'
  if (Math.abs(ratio - 2) <= ASPECT_TOLERANCE) return 'equirectangular'
  return null
}

/** Paul Bourke warp-mesh type digit for a source projection. */
export function warpMeshTypeForProjection(projection: SourceProjection): number {
  return projection === 'fisheye' ? 2 : 4
}

/**
 * Baked-in pitch that lands an equirectangular source the same way up as a
 * fisheye one, so both start from a sensible orientation with the user-facing
 * pitch still reading 0.
 */
const EQUIRECT_PITCH_OFFSET = 180

/**
 * Converts a world-space dome direction into equirectangular UV coordinates.
 * Longitude 0 faces +Y (dome front). Latitude 0 is the horizon and +1 is zenith.
 */
export function directionToEquirectUV(
  direction: Vector3,
  orientation: SourceOrientation = { yaw: 0, pitch: 0, roll: 0 },
): { u: number; v: number } {
  const rotated = applyOrientation(direction, {
    ...orientation,
    pitch: orientation.pitch + EQUIRECT_PITCH_OFFSET,
  })
  const longitude = Math.atan2(rotated.x, rotated.y)
  const latitude = Math.asin(MathUtils.clamp(rotated.z, -1, 1))
  const u = MathUtils.euclideanModulo(longitude / TWO_PI + 0.5, 1)
  const v = 0.5 - latitude / Math.PI
  return { u, v }
}

/**
 * Angular fisheye for a square fulldome master: zenith at the image centre,
 * horizon (dome base) on the inscribed circle that touches the mid-edges.
 * Azimuth 0 (+Y front) maps toward the bottom of the frame.
 */
export function directionToFisheyeUV(
  direction: Vector3,
  orientation: SourceOrientation = { yaw: 0, pitch: 0, roll: 0 },
): { u: number; v: number } {
  const rotated = applyOrientation(direction, orientation)
  const azimuth = Math.atan2(rotated.x, rotated.y)
  const polar = Math.acos(MathUtils.clamp(rotated.z, -1, 1))
  // polar = π/2 (horizon) → radius 0.5 (mid-edge of the square).
  const radius = polar / Math.PI
  const u = 0.5 + radius * Math.sin(azimuth)
  const v = 0.5 + radius * Math.cos(azimuth)
  return { u, v }
}

/** Samples a dome direction in the active source projection. */
export function directionToSourceUV(
  direction: Vector3,
  projection: SourceProjection,
  orientation: SourceOrientation = { yaw: 0, pitch: 0, roll: 0 },
): { u: number; v: number } {
  return projection === 'fisheye'
    ? directionToFisheyeUV(direction, orientation)
    : directionToEquirectUV(direction, orientation)
}

export function formatMeshNumber(value: number): string {
  if (!Number.isFinite(value)) return '0'
  if (Object.is(value, -0)) return '0'
  const rounded = Number(value.toPrecision(6))
  if (Object.is(rounded, -0)) return '0'
  return String(rounded)
}
