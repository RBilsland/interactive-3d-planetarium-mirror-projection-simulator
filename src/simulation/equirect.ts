import { MathUtils, Vector3 } from 'three'
import type { SourceOrientation } from './types'

const TWO_PI = Math.PI * 2

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

/**
 * Converts a world-space dome direction into equirectangular UV coordinates.
 * Longitude 0 faces +Y (dome front). Latitude 0 is the horizon and +1 is zenith.
 * Orientation rotates the source image before sampling (Z-up: yaw about Z,
 * pitch about X, roll about Y).
 */
export function directionToEquirectUV(
  direction: Vector3,
  orientation: SourceOrientation = { yaw: 0, pitch: 0, roll: 0 },
): { u: number; v: number } {
  const rotated = direction.clone().normalize()
  if (
    orientation.yaw !== 0
    || orientation.pitch !== 0
    || orientation.roll !== 0
  ) {
    // Inverse of the viewer orientation: rotate the lookup direction opposite
    // the yaw/pitch/roll applied to the panorama.
    rotateAroundZ(rotated, -MathUtils.degToRad(orientation.yaw))
    rotateAroundX(rotated, -MathUtils.degToRad(orientation.pitch))
    rotateAroundY(rotated, -MathUtils.degToRad(orientation.roll))
  }

  const longitude = Math.atan2(rotated.x, rotated.y)
  const latitude = Math.asin(MathUtils.clamp(rotated.z, -1, 1))
  const u = MathUtils.euclideanModulo(longitude / TWO_PI + 0.5, 1)
  const v = 0.5 - latitude / Math.PI

  return { u, v }
}

export function formatMeshNumber(value: number): string {
  if (!Number.isFinite(value)) return '0'
  if (Object.is(value, -0)) return '0'
  const rounded = Number(value.toPrecision(6))
  if (Object.is(rounded, -0)) return '0'
  return String(rounded)
}
