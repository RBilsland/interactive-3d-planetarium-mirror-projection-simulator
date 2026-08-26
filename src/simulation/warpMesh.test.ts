import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { directionToEquirectUV, formatMeshNumber } from './equirect'
import {
  buildWarpMesh,
  expandGridBounds,
  getUsableRayGridBounds,
  sanitizeMeshFilename,
  scaleGridBounds,
  serializeWarpMesh,
  WARP_MESH_TYPE,
} from './warpMesh'
import type { SimulationParameters } from './types'

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

describe('equirectangular mapping', () => {
  it('maps the dome front to the panorama centre', () => {
    const uv = directionToEquirectUV(new Vector3(0, 1, 0))
    expect(uv.u).toBeCloseTo(0.5)
    expect(uv.v).toBeCloseTo(0.5)
  })

  it('maps zenith near the top of the panorama', () => {
    const uv = directionToEquirectUV(new Vector3(0, 0, 1))
    expect(uv.u).toBeCloseTo(0.5)
    expect(uv.v).toBeCloseTo(0)
  })

  it('rotates longitude when yaw is applied', () => {
    const baseline = directionToEquirectUV(new Vector3(0, 1, 0))
    const yawed = directionToEquirectUV(new Vector3(0, 1, 0), {
      yaw: 90,
      pitch: 0,
      roll: 0,
    })
    expect(yawed.u).not.toBeCloseTo(baseline.u)
    expect(yawed.v).toBeCloseTo(baseline.v, 3)
  })
})

describe('usable mesh bounds', () => {
  it('derives a bounding box from mapped rays only', () => {
    const mesh = buildWarpMesh(parameters)
    expect(mesh.bounds).not.toBeNull()
    expect(mesh.bounds!.maxColumn).toBeGreaterThan(mesh.bounds!.minColumn)
    expect(mesh.bounds!.maxRow).toBeGreaterThan(mesh.bounds!.minRow)
  })

  it('scales bounds between grid resolutions', () => {
    const mesh = buildWarpMesh(parameters)
    const scaled = scaleGridBounds(mesh.bounds!, 100, 60, 64, 36)
    expect(scaled.minColumn).toBeGreaterThanOrEqual(0)
    expect(scaled.maxColumn).toBeLessThan(64)
    expect(expandGridBounds(scaled, 64, 36).minColumn).toBeGreaterThanOrEqual(0)
  })
})

describe('warp mesh export', () => {
  it('writes a sparse Bourke-style mesh with only mapped nodes', () => {
    const mesh = buildWarpMesh(parameters)
    const text = serializeWarpMesh(mesh)
    const lines = text.trimEnd().split('\n')

    expect(mesh.type).toBe(WARP_MESH_TYPE)
    expect(mesh.rows).toBe(1)
    expect(mesh.nodes.length).toBeGreaterThan(0)
    expect(mesh.nodes.length).toBeLessThan(100 * 60)
    expect(mesh.columns).toBe(mesh.nodes.length)
    expect(lines[0]).toBe('4')
    expect(lines[1]).toBe(`${mesh.nodes.length} 1`)
    expect(lines).toHaveLength(2 + mesh.nodes.length)
    expect(mesh.nodes.every((node) => node.intensity === 1)).toBe(true)
  })

  it('emits projector coordinates in bottom-to-top row order', () => {
    const mesh = buildWarpMesh(parameters)
    const aspect = 16 / 9
    const first = mesh.nodes[0]
    const last = mesh.nodes[mesh.nodes.length - 1]

    expect(first.y).toBeLessThanOrEqual(last.y)
    expect(first.x).toBeGreaterThanOrEqual(-aspect)
    expect(last.x).toBeLessThanOrEqual(aspect)
  })

  it('omits unmapped projector pixels entirely', () => {
    const mesh = buildWarpMesh({
      ...parameters,
      projectorFov: 10,
      projectorDistance: 3.5,
    })
    expect(mesh.nodes.length).toBeGreaterThan(0)
    expect(mesh.nodes.every((node) => node.intensity === 1 && node.u >= 0 && node.u <= 1)).toBe(
      true,
    )
  })

  it('can include chassis-occluded rays in the mesh', () => {
    const excluded = buildWarpMesh(parameters, { includeOccluded: false })
    const included = buildWarpMesh(parameters, { includeOccluded: true })

    expect(included.nodes.length).toBeGreaterThanOrEqual(excluded.nodes.length)
  })

  it('produces finite deterministic output for a fixed setup', () => {
    const first = serializeWarpMesh(buildWarpMesh(parameters))
    const second = serializeWarpMesh(buildWarpMesh(parameters))
    expect(first).toBe(second)
    expect(first.split('\n').slice(2, -1).every((line) => {
      const values = line.split('\t').map(Number)
      return values.length === 5 && values.every(Number.isFinite)
    })).toBe(true)
  })

  it('formats numbers without negative zero', () => {
    expect(formatMeshNumber(-0)).toBe('0')
    expect(formatMeshNumber(1.7777777)).toBe('1.77778')
  })

  it('sanitises download filenames', () => {
    expect(sanitizeMeshFilename('Hall A')).toBe('hall_a.data')
    expect(sanitizeMeshFilename('   ')).toBe('domecast_equirect.data')
  })

  it('returns null bounds when no rays are usable', () => {
    expect(getUsableRayGridBounds([], false)).toBeNull()
  })
})
