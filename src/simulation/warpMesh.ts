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
  /** Column count of the exported rectangular Bourke grid. */
  columns: number
  /** Row count of the exported rectangular Bourke grid. */
  rows: number
  /** Row-major grid nodes (`columns * rows`), including intensity -1 holes. */
  nodes: WarpMeshNode[]
  /** Source grid indices covered by this export (inclusive). */
  bounds: GridBounds | null
}

/** Total mirror-reflected travel distance from projector to dome hit. */
export function rayPathLength(
  ray: TracedRay & {
    mirrorHit: NonNullable<TracedRay['mirrorHit']>
    domeHit: NonNullable<TracedRay['domeHit']>
  },
): number {
  return ray.origin.distanceTo(ray.mirrorHit) + ray.mirrorHit.distanceTo(ray.domeHit)
}

/** Normalise path length so the longest ray is 1 and shorter rays are dimmed. */
export function pathLengthIntensity(pathLength: number, maxPathLength: number): number {
  if (maxPathLength <= 0) return 1
  return Math.min(1, Math.max(0, pathLength / maxPathLength))
}

/** Rays that reach the dome and should feed warp / preview mesh geometry. */
export function isMeshUsableRay(
  ray: TracedRay | undefined,
  includeOccluded = false,
): ray is TracedRay & {
  mirrorHit: NonNullable<TracedRay['mirrorHit']>
  domeHit: NonNullable<TracedRay['domeHit']>
} {
  if (!ray?.domeHit || !ray.mirrorHit) return false
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

function buildUsableGridLookup(
  rays: TracedRay[],
  includeOccluded: boolean,
): Set<string> {
  const usable = new Set<string>()
  for (const ray of rays) {
    if (isMeshUsableRay(ray, includeOccluded)) {
      usable.add(`${ray.column}:${ray.row}`)
    }
  }
  return usable
}

function rowHasUsableCell(
  bounds: GridBounds,
  row: number,
  usable: Set<string>,
): boolean {
  for (let column = bounds.minColumn; column <= bounds.maxColumn; column += 1) {
    if (usable.has(`${column}:${row}`)) return true
  }
  return false
}

function columnHasUsableCell(
  bounds: GridBounds,
  column: number,
  usable: Set<string>,
): boolean {
  for (let row = bounds.minRow; row <= bounds.maxRow; row += 1) {
    if (usable.has(`${column}:${row}`)) return true
  }
  return false
}

/**
 * Shrinks bounds by removing outer rows/columns that contain no mapped cells.
 * Internal all-empty rows/columns are kept so grid adjacency stays correct.
 */
export function tightenGridBounds(
  bounds: GridBounds,
  usable: Set<string>,
): GridBounds {
  let { minColumn, maxColumn, minRow, maxRow } = bounds

  while (minRow <= maxRow && !rowHasUsableCell({ minColumn, maxColumn, minRow, maxRow }, minRow, usable)) {
    minRow += 1
  }
  while (minRow <= maxRow && !rowHasUsableCell({ minColumn, maxColumn, minRow, maxRow }, maxRow, usable)) {
    maxRow -= 1
  }
  while (minColumn <= maxColumn && !columnHasUsableCell({ minColumn, maxColumn, minRow, maxRow }, minColumn, usable)) {
    minColumn += 1
  }
  while (minColumn <= maxColumn && !columnHasUsableCell({ minColumn, maxColumn, minRow, maxRow }, maxColumn, usable)) {
    maxColumn -= 1
  }

  if (minColumn > maxColumn || minRow > maxRow) return bounds

  return { minColumn, maxColumn, minRow, maxRow }
}

/** Bounds for Bourke export: mapped footprint with empty outer rows/columns removed. */
export function getExportGridBounds(
  rays: TracedRay[],
  includeOccluded = false,
): GridBounds | null {
  const usable = buildUsableGridLookup(rays, includeOccluded)
  if (usable.size === 0) return null

  const bounds = getUsableRayGridBounds(rays, includeOccluded)
  if (!bounds) return null

  return tightenGridBounds(bounds, usable)
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
 * Builds a Paul Bourke rectangular warp mesh cropped to the projector footprint.
 * Adjacent grid cells can be triangulated normally; intensity -1 marks holes.
 */
export function buildWarpMesh(
  params: SimulationParameters,
  options: WarpMeshOptions = {},
): WarpMesh {
  const sourceColumns = options.columns ?? WARP_MESH_COLUMNS
  const sourceRows = options.rows ?? WARP_MESH_ROWS
  const orientation = options.orientation ?? { yaw: 0, pitch: 0, roll: 0 }
  const includeOccluded = options.includeOccluded ?? false
  const aspect = aspectRatioValue(params.aspectRatio)

  const result = traceProjection({
    ...params,
    gridColumns: sourceColumns,
    gridRows: sourceRows,
  })
  const usableBounds = getExportGridBounds(result.rays, includeOccluded)
  if (!usableBounds) {
    return {
      type: WARP_MESH_TYPE,
      columns: 0,
      rows: 0,
      nodes: [],
      bounds: null,
    }
  }

  const bounds = usableBounds
  const exportColumns = bounds.maxColumn - bounds.minColumn + 1
  const exportRows = bounds.maxRow - bounds.minRow + 1
  const byGrid = new Map(
    result.rays.map((ray) => [`${ray.column}:${ray.row}`, ray]),
  )

  let maxPathLength = 0
  for (const ray of result.rays) {
    if (!isMeshUsableRay(ray, includeOccluded)) continue
    if (
      ray.column < bounds.minColumn
      || ray.column > bounds.maxColumn
      || ray.row < bounds.minRow
      || ray.row > bounds.maxRow
    ) {
      continue
    }
    maxPathLength = Math.max(maxPathLength, rayPathLength(ray))
  }

  const nodes: WarpMeshNode[] = []

  // Match Paul Bourke sample meshes: rows run bottom (y = -1) to top (y = +1).
  for (let exportRow = 0; exportRow < exportRows; exportRow += 1) {
    const rayRow = bounds.maxRow - exportRow

    for (let exportColumn = 0; exportColumn < exportColumns; exportColumn += 1) {
      const rayColumn = bounds.minColumn + exportColumn
      const { x, y } = projectorCoordinates(
        rayColumn,
        rayRow,
        sourceColumns,
        sourceRows,
        aspect,
      )
      const ray = byGrid.get(`${rayColumn}:${rayRow}`)

      if (isMeshUsableRay(ray, includeOccluded)) {
        const uv = directionToEquirectUV(ray.domeHit, orientation)
        nodes.push({
          x,
          y,
          u: uv.u,
          v: uv.v,
          intensity: pathLengthIntensity(rayPathLength(ray), maxPathLength),
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
    columns: exportColumns,
    rows: exportRows,
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
