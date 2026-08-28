import type { Vector3 } from 'three'

export type AspectRatio = '16:9' | '16:10' | '4:3'
export type RayStatus = 'valid' | 'overshot' | 'occluded'
/** Fulldome source image layout inferred from pixel aspect. */
export type SourceProjection = 'equirectangular' | 'fisheye'

/** Inclusive projector pixel-grid indices limiting which rays are traced. */
export interface GridBounds {
  minColumn: number
  maxColumn: number
  minRow: number
  maxRow: number
}

export interface SimulationParameters {
  domeDiameter: number
  mirrorDiameter: number
  mirrorHeight: number
  /** Mirror pitch-down angle in degrees (`0` = upright). */
  mirrorPitch: number
  /** Front-of-mirror to front-of-projector gap in meters (`0` = touching). */
  projectorDistance: number
  projectorHeight: number
  projectorPitch: number
  lensShiftVertical: number
  lensShiftHorizontal: number
  /** Diagonal field of view in degrees. */
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
  showApexMarker: boolean
  excludeOccludedFromMesh: boolean
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
