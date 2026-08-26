import { aspectRatioValue, traceProjection } from './rayTracer'
import { directionToEquirectUV, formatMeshNumber } from './equirect'
import type {
  GridBounds,
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
  /** Usable node count for sparse Bourke export (`count 1` header). */
  columns: number
  /** Always `1` for sparse export — only mapped nodes are written. */
  rows: number
  nodes: WarpMeshNode[]
  /** Projector grid bounds that contain every exported node. */
  bounds: GridBounds | null
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

/** Inclusive grid indices of rays that can contribute to mesh geometry. */
export function getUsableRayGridBounds(
  rays: TracedRay[],
  includeOccluded = false,
): GridBounds | null {
  let minColumn = Infinity
  let maxColumn = -Infinity
  let minRow = Infinity
  let maxRow = -Infinity

  for (const ray of rays) {
    if (!isMeshUsableRay(ray, includeOccluded)) continue
    minColumn = Math.min(minColumn, ray.column)
    maxColumn = Math.max(maxColumn, ray.column)
    minRow = Math.min(minRow, ray.row)
    maxRow = Math.max(maxRow, ray.row)
  }

  if (!Number.isFinite(minColumn)) return null

  return { minColumn, maxColumn, minRow, maxRow }
}

export function expandGridBounds(
  bounds: GridBounds,
  columns: number,
  rows: number,
  margin = 1,
): GridBounds {
  return {
    minColumn: Math.max(0, bounds.minColumn - margin),
    maxColumn: Math.min(columns - 1, bounds.maxColumn + margin),
    minRow: Math.max(0, bounds.minRow - margin),
    maxRow: Math.min(rows - 1, bounds.maxRow + margin),
  }
}

/** Map bounds from one ray grid resolution to another. */
export function scaleGridBounds(
  bounds: GridBounds,
  fromColumns: number,
  fromRows: number,
  toColumns: number,
  toRows: number,
): GridBounds {
  const columnScale = (toColumns - 1) / Math.max(1, fromColumns - 1)
  const rowScale = (toRows - 1) / Math.max(1, fromRows - 1)

  return {
    minColumn: Math.max(0, Math.floor(bounds.minColumn * columnScale)),
    maxColumn: Math.min(toColumns - 1, Math.ceil(bounds.maxColumn * columnScale)),
    minRow: Math.max(0, Math.floor(bounds.minRow * rowScale)),
    maxRow: Math.min(toRows - 1, Math.ceil(bounds.maxRow * rowScale)),
  }
}

function projectorCoordinates(
  column: number,
  row: number,
  columns: number,
  rows: number,
  aspect: number,
): { x: number; y: number } {
  const exportRow = rows - 1 - row
  return {
    x: -aspect + (column / (columns - 1)) * aspect * 2,
    y: -1 + (exportRow / (rows - 1)) * 2,
  }
}

/**
 * Builds a Paul Bourke equirectangular warp mesh containing only projector
 * pixels that actually map onto the dome. Unmapped rays are omitted entirely.
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
  const bounds = getUsableRayGridBounds(result.rays, includeOccluded)

  const nodes: WarpMeshNode[] = []
  for (const ray of result.rays) {
    if (!isMeshUsableRay(ray, includeOccluded)) continue
    const uv = directionToEquirectUV(ray.domeHit, orientation)
    const { x, y } = projectorCoordinates(ray.column, ray.row, columns, rows, aspect)
    nodes.push({
      x,
      y,
      u: uv.u,
      v: uv.v,
      intensity: 1,
    })
  }

  nodes.sort((left, right) => {
    if (left.y !== right.y) return left.y - right.y
    return left.x - right.x
  })

  return {
    type: WARP_MESH_TYPE,
    columns: nodes.length,
    rows: 1,
    nodes,
    bounds,
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
