import type { Vector3 } from 'three'

export type AspectRatio = '16:9' | '16:10' | '4:3'
export type RayStatus = 'valid' | 'overshot' | 'occluded'

/** Inclusive projector pixel-grid indices limiting which rays are traced. */
export interface GridBounds {
  minColumn: number
  maxColumn: number
  minRow: number
  maxRow: number
}

export interface SimulationParameters {
  domeRadius: number
  mirrorRadius: number
  mirrorHeight: number
  projectorDistance: number
  projectorHeight: number
  projectorPitch: number
  lensShiftVertical: number
  lensShiftHorizontal: number
  projectorFov: number
  aspectRatio: AspectRatio
  gridColumns: number
  gridRows: number
}

export interface SourceOrientation {
  yaw: number
  pitch: number
  roll: number
}

export interface DisplayOptions {
  showRays: boolean
  showProjector: boolean
  showPixelGrid: boolean
  showGround: boolean
  showSourcePreview: boolean
  /** When true, chassis-shadowed rays still contribute to warp mesh and preview. */
  includeOccludedInMesh: boolean
}

export interface TracedRay {
  column: number
  row: number
  origin: Vector3
  direction: Vector3
  mirrorHit: Vector3 | null
  domeHit: Vector3 | null
  reflectedDirection: Vector3 | null
  status: RayStatus
}

export interface TraceResult {
  rays: TracedRay[]
  coveragePercent: number
  mirrorHitPercent: number
  mirrorUsePercent: number
  mirrorHitCount: number
  shadowOccluded: boolean
  validCount: number
  missedCount: number
  occludedCount: number
  occludedPercent: number
  beamClearance: number
}
