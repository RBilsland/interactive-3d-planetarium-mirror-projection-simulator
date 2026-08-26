import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { directionToEquirectUV, formatMeshNumber } from './equirect'
import {
  buildWarpMesh,
  sanitizeMeshFilename,
  serializeWarpMesh,
  WARP_MESH_COLUMNS,
  WARP_MESH_ROWS,
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

describe('warp mesh export', () => {
  it('writes a Bourke-style equirectangular mesh header and node count', () => {
    const mesh = buildWarpMesh(parameters)
    const text = serializeWarpMesh(mesh)
    const lines = text.trimEnd().split('\n')

    expect(mesh.type).toBe(WARP_MESH_TYPE)
    expect(mesh.columns).toBe(WARP_MESH_COLUMNS)
    expect(mesh.rows).toBe(WARP_MESH_ROWS)
    expect(mesh.nodes).toHaveLength(WARP_MESH_COLUMNS * WARP_MESH_ROWS)
    expect(lines[0]).toBe('4')
    expect(lines[1]).toBe('100 60')
    expect(lines).toHaveLength(2 + WARP_MESH_COLUMNS * WARP_MESH_ROWS)
  })

  it('emits a regular projector grid in row-major order', () => {
    const mesh = buildWarpMesh(parameters)
    const aspect = 16 / 9
    const first = mesh.nodes[0]
    const last = mesh.nodes[mesh.nodes.length - 1]
    const second = mesh.nodes[1]

    expect(first.x).toBeCloseTo(-aspect)
    expect(first.y).toBeCloseTo(-1)
    expect(second.x).toBeGreaterThan(first.x)
    expect(second.y).toBeCloseTo(first.y)
    expect(last.x).toBeCloseTo(aspect)
    expect(last.y).toBeCloseTo(1)
  })

  it('masks invalid projector nodes with negative intensity', () => {
    const mesh = buildWarpMesh({
      ...parameters,
      projectorFov: 10,
      projectorDistance: 3.5,
    })
    expect(mesh.nodes.some((node) => node.intensity < 0)).toBe(true)
    expect(
      mesh.nodes.every(
        (node) =>
          (node.intensity === 1 && node.u >= 0 && node.u <= 1)
          || node.intensity === -1,
      ),
    ).toBe(true)
  })

  it('can include chassis-occluded rays in the mesh', () => {
    const excluded = buildWarpMesh(parameters, { includeOccluded: false })
    const included = buildWarpMesh(parameters, { includeOccluded: true })
    const excludedLive = excluded.nodes.filter((node) => node.intensity === 1)
    const includedLive = included.nodes.filter((node) => node.intensity === 1)

    expect(includedLive.length).toBeGreaterThanOrEqual(excludedLive.length)
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
})
