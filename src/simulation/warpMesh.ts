import { aspectRatioValue, traceProjection } from './rayTracer'
import { directionToEquirectUV, formatMeshNumber } from './equirect'
import type {
  SimulationParameters,
  SourceOrientation,
  TracedRay,
} from './types'

export const WARP_MESH_COLUMNS = 100
export const WARP_MESH_ROWS = 60
export const WARP_MESH_TYPE = 4

export interface WarpMeshOptions {
  columns?: number
  rows?: number
  orientation?: SourceOrientation
  includeOccluded?: boolean
}

export interface WarpMeshNode {
  x: number
  y: number
  u: number
  v: number
  intensity: number
}

export interface WarpMesh {
  type: number
  columns: number
  rows: number
  nodes: WarpMeshNode[]
}

/** Rays that reach the dome and should feed warp / preview mesh geometry. */
export function isMeshUsableRay(
  ray: TracedRay | undefined,
  includeOccluded = false,
): ray is TracedRay & { domeHit: NonNullable<TracedRay['domeHit']> } {
  if (!ray?.domeHit) return false
  if (ray.status === 'valid') return true
  return includeOccluded && ray.status === 'occluded'
}

/**
 * Builds a Paul Bourke rectangular warp mesh for an equirectangular source.
 * Projector (x,y) forms a regular grid in normalised screen space; (u,v) sample
 * the panorama at the dome direction each projector pixel would light.
 */
export function buildWarpMesh(
  params: SimulationParameters,
  options: WarpMeshOptions = {},
): WarpMesh {
  const columns = options.columns ?? WARP_MESH_COLUMNS
  const rows = options.rows ?? WARP_MESH_ROWS
  const orientation = options.orientation ?? { yaw: 0, pitch: 0, roll: 0 }
  const includeOccluded = options.includeOccluded ?? false
  const aspect = aspectRatioValue(params.aspectRatio)
  const result = traceProjection({
    ...params,
    gridColumns: columns,
    gridRows: rows,
  })
  const nodes: WarpMeshNode[] = []
  const byGrid = new Map(
    result.rays.map((ray) => [`${ray.column}:${ray.row}`, ray]),
  )

  // Match Paul Bourke sample meshes: rows run bottom (y = -1) to top (y = +1).
  for (let exportRow = 0; exportRow < rows; exportRow += 1) {
    const y = -1 + (exportRow / (rows - 1)) * 2
    const rayRow = rows - 1 - exportRow

    for (let column = 0; column < columns; column += 1) {
      const x = -aspect + (column / (columns - 1)) * aspect * 2
      const ray = byGrid.get(`${column}:${rayRow}`)

      if (isMeshUsableRay(ray, includeOccluded)) {
        const uv = directionToEquirectUV(ray.domeHit, orientation)
        nodes.push({
          x,
          y,
          u: uv.u,
          v: uv.v,
          intensity: 1,
        })
        continue
      }

      nodes.push({
        x,
        y,
        u: 0,
        v: 0,
        intensity: -1,
      })
    }
  }

  return {
    type: WARP_MESH_TYPE,
    columns,
    rows,
    nodes,
  }
}

export function serializeWarpMesh(mesh: WarpMesh): string {
  const lines = [
    String(mesh.type),
    `${mesh.columns} ${mesh.rows}`,
    ...mesh.nodes.map(
      (node) =>
        [
          formatMeshNumber(node.x),
          formatMeshNumber(node.y),
          formatMeshNumber(node.u),
          formatMeshNumber(node.v),
          formatMeshNumber(node.intensity),
        ].join('\t'),
    ),
  ]

  return `${lines.join('\n')}\n`
}

export function downloadWarpMesh(
  text: string,
  filename = 'domecast_equirect.data',
): void {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

export function sanitizeMeshFilename(name: string): string {
  const trimmed = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_')
  const cleaned = trimmed.replace(/^_+|_+$/g, '')
  return cleaned.length > 0 ? `${cleaned}.data` : 'domecast_equirect.data'
}
