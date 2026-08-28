import {
  AmbientLight,
  BackSide,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  ClampToEdgeWrapping,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  DynamicDrawUsage,
  EdgesGeometry,
  GridHelper,
  Group,
  LineBasicMaterial,
  LineSegments,
  Material,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  PointsMaterial,
  RepeatWrapping,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  Vector3,
  WebGLRenderer,
} from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { directionToSourceUV, detectSourceProjection } from '../simulation/equirect'
import {
  getDomeRadius,
  getMirrorCenter,
  getMirrorRadius,
  getMirrorRotation,
  getProjectorCenter,
  traceProjection,
} from '../simulation/rayTracer'
import { isMeshUsableRay, expandGridBounds, scaleGridBounds, getUsableRayGridBounds } from '../simulation/warpMesh'
import type {
  DisplayOptions,
  GridBounds,
  SimulationParameters,
  SourceOrientation,
  SourceProjection,
  TraceResult,
  TracedRay,
} from '../simulation/types'

const STATUS_COLORS = {
  valid: new Color('#58e6c2'),
  overshot: new Color('#ff9f5a'),
  occluded: new Color('#ff4d8d'),
}

/** Dense enough to look continuous, light enough for interactive updates. */
const PREVIEW_COLUMNS = 64
const PREVIEW_ROWS = 36

/** Seated-observer eye height at the dome centre, in meters. */
const DOME_VIEW_EYE_HEIGHT = 1.5
/**
 * Orbit radius used to fake a look-around camera: the pivot sits just in front
 * of the lens, so rotating it turns the view without moving the observer.
 */
const DOME_VIEW_PIVOT_DISTANCE = 0.01

export type ViewMode = 'fly' | 'dome'

/** A compass marker on the ground, placed along a unit direction in the XY plane. */
interface GroundLabel {
  mesh: Mesh
  texture: CanvasTexture
  directionX: number
  directionY: number
}

/**
 * Renders the simulation. Every mesh is built once at unit size and resized by
 * transform alone: rebuilding geometry per parameter change churns through GPU
 * resources fast enough to make Safari drop the WebGL context.
 */
export class PlanetariumScene {
  private readonly scene = new Scene()
  private readonly camera = new PerspectiveCamera(42, 1, 0.05, 100)
  private readonly renderer: WebGLRenderer
  private readonly controls: OrbitControls
  private readonly container: HTMLElement

  private readonly domeShell: Mesh
  private readonly domeWireframe: LineSegments
  private readonly domeRim: Mesh
  private readonly domeDefaultMaterial: MeshPhysicalMaterial
  private readonly projectedImage: Mesh
  private readonly projectedImageMaterial: MeshBasicMaterial
  private readonly ground: Mesh
  private readonly groundGrid: GridHelper
  private readonly groundLabels: GroundLabel[]
  private readonly mirror = new Group()
  private readonly projector = new Group()
  private readonly projectorLens: Mesh

  private readonly rayLines: LineSegments
  private readonly gridLines: LineSegments
  private readonly gridPoints: Points
  private rayPositions = new Float32Array(0)
  private rayColors = new Float32Array(0)
  private gridLinePositions = new Float32Array(0)
  private gridPointPositions = new Float32Array(0)
  private projectedPositions = new Float32Array(0)
  private projectedUvs = new Float32Array(0)

  private sourceTexture: Texture | null = null
  private sourceObjectUrl: string | null = null
  private sourceProjection: SourceProjection | null = null
  private animationFrame = 0
  private contextLossCount = 0
  private viewMode: ViewMode = 'fly'
  private flyCameraState: {
    position: Vector3
    target: Vector3
  } | null = null

  constructor(container: HTMLElement) {
    this.container = container
    this.renderer = new WebGLRenderer({ antialias: true, alpha: false })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.outputColorSpace = SRGBColorSpace
    this.renderer.setClearColor(0x05080d, 1)
    this.container.appendChild(this.renderer.domElement)

    this.camera.position.set(7.8, 8.2, 5.4)
    this.camera.up.set(0, 0, 1)

    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.target.set(0, 0, 1.6)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.07
    this.controls.minDistance = 2
    this.controls.maxDistance = 28
    this.controls.maxPolarAngle = Math.PI * 0.92

    this.scene.add(new AmbientLight(0x92adcf, 1.2))
    const keyLight = new DirectionalLight(0xffffff, 2.2)
    keyLight.position.set(4, 5, 9)
    this.scene.add(keyLight)
    const rimLight = new DirectionalLight(0x4b78ff, 1.5)
    rimLight.position.set(-5, -7, 4)
    this.scene.add(rimLight)

    this.domeDefaultMaterial = new MeshPhysicalMaterial({
      color: 0x6484a9,
      transparent: true,
      opacity: 0.17,
      roughness: 0.86,
      metalness: 0.05,
      side: BackSide,
      depthWrite: false,
    })
    this.projectedImageMaterial = new MeshBasicMaterial({
      map: null,
      side: BackSide,
      transparent: true,
      opacity: 0.94,
      depthWrite: false,
    })

    const dome = this.createDome()
    this.domeShell = dome.shell
    this.domeWireframe = dome.wireframe
    this.domeRim = dome.rim

    this.projectedImage = this.createProjectedImage()

    const ground = this.createGround()
    this.ground = ground.disc
    this.groundGrid = ground.grid

    this.groundLabels = this.createGroundLabels()

    this.createMirror()
    this.projectorLens = this.createProjector()

    const beams = this.createBeamObjects()
    this.rayLines = beams.rayLines
    this.gridLines = beams.gridLines
    this.gridPoints = beams.gridPoints

    this.resize()
    window.addEventListener('resize', this.resize)
    this.renderer.domElement.addEventListener(
      'webglcontextlost',
      this.onContextLost,
    )
    this.renderer.domElement.addEventListener(
      'webglcontextrestored',
      this.onContextRestored,
    )
    this.animate()
  }

  update(
    params: SimulationParameters,
    display: DisplayOptions,
    orientation: SourceOrientation = { yaw: 0, pitch: 0, roll: 0 },
  ): TraceResult {
    const result = traceProjection(params)
    const domeRadius = getDomeRadius(params)
    const mirrorRadius = getMirrorRadius(params)

    this.domeShell.scale.setScalar(domeRadius)
    this.domeWireframe.scale.setScalar(domeRadius)
    this.domeRim.scale.set(domeRadius, 1, domeRadius)
    this.domeShell.material = this.domeDefaultMaterial

    const insideDome = this.viewMode === 'dome'
    this.ground.scale.setScalar(domeRadius * 1.08)
    this.groundGrid.scale.set(domeRadius * 2.15, 1, domeRadius * 2.15)
    this.ground.visible = display.showGround
    // From inside, the grid spills past the dome shell and clutters the view.
    this.groundGrid.visible = display.showGround && !insideDome
    const groundMaterial = this.ground.material as MeshStandardMaterial
    groundMaterial.opacity = insideDome ? 0.35 : 0.86

    // Just inside the dome rim so they stay readable even when the projected
    // image reaches the dome base.
    for (const label of this.groundLabels) {
      label.mesh.position.x = label.directionX * domeRadius * 0.87
      label.mesh.position.y = label.directionY * domeRadius * 0.87
      label.mesh.scale.set(domeRadius * 0.34, domeRadius * 0.085, 1)
      label.mesh.visible = display.showGround
    }

    this.mirror.position.copy(getMirrorCenter(params))
    this.mirror.rotation.copy(getMirrorRotation(params))
    this.mirror.scale.setScalar(mirrorRadius)

    this.projector.position.copy(getProjectorCenter(params))
    this.projector.rotation.x = (params.projectorPitch * Math.PI) / 180
    this.projectorLens.position.set(
      params.lensShiftHorizontal * 0.08,
      -0.37,
      params.lensShiftVertical * 0.06,
    )
    this.projector.visible = display.showProjector

    this.rayLines.visible = display.showRays
    if (display.showRays) this.writeRayBundle(result.rays, domeRadius)

    this.gridLines.visible = display.showPixelGrid
    this.gridPoints.visible = display.showPixelGrid
    if (display.showPixelGrid) this.writeDomeGrid(result.rays, params)

    const showProjected =
      display.showSourcePreview && this.sourceTexture !== null
    this.projectedImage.visible = showProjected
    if (showProjected) {
      const footprint = getUsableRayGridBounds(
        result.rays,
        !display.excludeOccludedFromMesh,
      )
      if (!footprint) {
        this.projectedImage.visible = false
      } else {
        const previewBounds = expandGridBounds(
          scaleGridBounds(
            footprint,
            params.gridColumns,
            params.gridRows,
            PREVIEW_COLUMNS,
            PREVIEW_ROWS,
          ),
          PREVIEW_COLUMNS,
          PREVIEW_ROWS,
        )
        const preview = traceProjection(
          {
            ...params,
            gridColumns: PREVIEW_COLUMNS,
            gridRows: PREVIEW_ROWS,
          },
          { gridBounds: previewBounds },
        )
        this.writeProjectedImage(
          preview.rays,
          domeRadius,
          orientation,
          !display.excludeOccludedFromMesh,
          previewBounds,
          this.sourceProjection ?? 'equirectangular',
        )
      }
    }

    return result
  }

  getViewMode(): ViewMode {
    return this.viewMode
  }

  /**
   * `fly` orbits the whole rig freely. `dome` pins the observer at the dome
   * centre and only lets them look around, restoring the previous fly camera
   * when they come back out.
   */
  setViewMode(mode: ViewMode): void {
    if (mode === this.viewMode) return
    this.viewMode = mode

    if (mode === 'dome') {
      this.flyCameraState = {
        position: this.camera.position.clone(),
        target: this.controls.target.clone(),
      }

      const eye = new Vector3(0, 0, DOME_VIEW_EYE_HEIGHT)
      // Keep facing the dome front so the "FRONT" marker lines up on entry.
      const pivot = eye
        .clone()
        .add(new Vector3(0, DOME_VIEW_PIVOT_DISTANCE, 0))

      this.camera.position.copy(eye)
      this.controls.target.copy(pivot)
      this.controls.enablePan = false
      this.controls.enableZoom = false
      this.controls.minDistance = DOME_VIEW_PIVOT_DISTANCE
      this.controls.maxDistance = DOME_VIEW_PIVOT_DISTANCE
      this.controls.maxPolarAngle = Math.PI
      this.controls.update()
      return
    }

    this.controls.enablePan = true
    this.controls.enableZoom = true
    this.controls.minDistance = 2
    this.controls.maxDistance = 28
    this.controls.maxPolarAngle = Math.PI * 0.92

    if (this.flyCameraState) {
      this.camera.position.copy(this.flyCameraState.position)
      this.controls.target.copy(this.flyCameraState.target)
      this.flyCameraState = null
    }
    this.controls.update()
  }

  async setSourceImage(
    file: File,
  ): Promise<{ width: number; height: number; projection: SourceProjection }> {
    const objectUrl = URL.createObjectURL(file)
    try {
      const texture = await new TextureLoader().loadAsync(objectUrl)
      const image = texture.image as { width: number; height: number }
      const projection = detectSourceProjection(image.width, image.height)
      if (!projection) {
        texture.dispose()
        URL.revokeObjectURL(objectUrl)
        throw new Error('INVALID_SOURCE_ASPECT')
      }

      texture.colorSpace = SRGBColorSpace
      texture.wrapS =
        projection === 'equirectangular' ? RepeatWrapping : ClampToEdgeWrapping
      texture.wrapT = ClampToEdgeWrapping
      texture.needsUpdate = true

      this.clearSourceImage(false)
      this.sourceObjectUrl = objectUrl
      this.sourceTexture = texture
      this.sourceProjection = projection
      this.projectedImageMaterial.map = texture
      this.projectedImageMaterial.needsUpdate = true

      return { width: image.width, height: image.height, projection }
    } catch (error) {
      if (!(error instanceof Error && error.message === 'INVALID_SOURCE_ASPECT')) {
        URL.revokeObjectURL(objectUrl)
      }
      throw error
    }
  }

  clearSourceImage(revokeUrl = true): void {
    if (this.sourceTexture) {
      this.sourceTexture.dispose()
      this.sourceTexture = null
    }
    if (revokeUrl && this.sourceObjectUrl) {
      URL.revokeObjectURL(this.sourceObjectUrl)
    }
    this.sourceObjectUrl = null
    this.sourceProjection = null
    this.projectedImageMaterial.map = null
    this.projectedImageMaterial.needsUpdate = true
    this.projectedImage.visible = false
    this.projectedImage.geometry.setDrawRange(0, 0)
  }

  hasSourceImage(): boolean {
    return this.sourceTexture !== null
  }

  getSourceProjection(): SourceProjection | null {
    return this.sourceProjection
  }

  private createProjectedImage(): Mesh {
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(0), 3))
    geometry.setAttribute('uv', new BufferAttribute(new Float32Array(0), 2))
    geometry.setDrawRange(0, 0)

    const mesh = new Mesh(geometry, this.projectedImageMaterial)
    mesh.frustumCulled = false
    mesh.renderOrder = -1
    mesh.visible = false
    this.scene.add(mesh)
    return mesh
  }

  private createDome(): {
    shell: Mesh
    wireframe: LineSegments
    rim: Mesh
  } {
    const geometry = new SphereGeometry(1, 64, 32, 0, Math.PI * 2, 0, Math.PI / 2)
    geometry.rotateX(Math.PI / 2)

    const shell = new Mesh(geometry, this.domeDefaultMaterial)
    shell.renderOrder = -2
    this.scene.add(shell)

    const wireframe = new LineSegments(
      new EdgesGeometry(geometry, 11),
      new LineBasicMaterial({
        color: 0x45627e,
        transparent: true,
        opacity: 0.28,
      }),
    )
    this.scene.add(wireframe)

    const rim = new Mesh(
      new CylinderGeometry(1, 1, 0.035, 96, 1, true),
      new MeshStandardMaterial({
        color: 0x7897b7,
        emissive: 0x17283b,
        metalness: 0.55,
        roughness: 0.45,
        side: DoubleSide,
      }),
    )
    rim.rotation.x = Math.PI / 2
    this.scene.add(rim)

    return { shell, wireframe, rim }
  }

  private createMirror(): void {
    // Quarter sphere: convex toward the dome (+Y), cut away below its centre height.
    const shell = new Mesh(
      new SphereGeometry(1, 48, 24, 0, Math.PI, 0, Math.PI / 2),
      new MeshPhysicalMaterial({
        color: 0xd8efff,
        metalness: 0.92,
        roughness: 0.08,
        clearcoat: 1,
        clearcoatRoughness: 0.05,
        side: DoubleSide,
      }),
    )
    this.mirror.add(shell)

    const capGeometry = new CircleGeometry(1, 48, 0, Math.PI)
    const capMaterial = new MeshStandardMaterial({
      color: 0x18222e,
      metalness: 0.6,
      roughness: 0.55,
      side: DoubleSide,
    })
    const capEdges = new EdgesGeometry(capGeometry)
    const rimMaterial = new LineBasicMaterial({
      color: 0xc3f4ff,
      transparent: true,
      opacity: 0.55,
    })

    for (const rotationX of [Math.PI / 2, 0]) {
      const cap = new Mesh(capGeometry, capMaterial)
      cap.rotation.x = rotationX
      this.mirror.add(cap)

      const rim = new LineSegments(capEdges, rimMaterial)
      rim.rotation.x = rotationX
      this.mirror.add(rim)
    }

    this.scene.add(this.mirror)
  }

  private createProjector(): Mesh {
    const chassisGeometry = new BoxGeometry(0.48, 0.68, 0.26)
    const chassis = new Mesh(
      chassisGeometry,
      new MeshStandardMaterial({
        color: 0x202b38,
        metalness: 0.72,
        roughness: 0.32,
      }),
    )
    this.projector.add(chassis)

    const outline = new LineSegments(
      new EdgesGeometry(chassisGeometry),
      new LineBasicMaterial({ color: 0x91abc2, transparent: true, opacity: 0.8 }),
    )
    this.projector.add(outline)

    const lens = new Mesh(
      new CylinderGeometry(0.095, 0.075, 0.07, 28),
      new MeshPhysicalMaterial({
        color: 0x6ee7ff,
        emissive: 0x114d66,
        metalness: 0.25,
        roughness: 0.08,
        clearcoat: 1,
      }),
    )
    this.projector.add(lens)
    this.scene.add(this.projector)

    return lens
  }

  private createGround(): { disc: Mesh; grid: GridHelper } {
    const disc = new Mesh(
      new CircleGeometry(1, 96),
      new MeshStandardMaterial({
        color: 0x0a1018,
        roughness: 1,
        metalness: 0,
        transparent: true,
        opacity: 0.86,
        side: DoubleSide,
      }),
    )
    disc.position.z = -0.025
    this.scene.add(disc)

    const grid = new GridHelper(1, 24, 0x30465c, 0x182536)
    grid.rotation.x = Math.PI / 2
    grid.position.z = -0.01
    const gridMaterial = grid.material as LineBasicMaterial
    gridMaterial.transparent = true
    gridMaterial.opacity = 0.32
    this.scene.add(grid)

    return { disc, grid }
  }

  /** Compass markers on the ground so the viewport keeps its bearings. */
  private createGroundLabels(): GroundLabel[] {
    // Facing +Y with +Z up puts right at +X, so left falls on -X.
    return [
      this.createGroundLabel('FRONT', 0, 1),
      this.createGroundLabel('RIGHT', 1, 0),
      this.createGroundLabel('BACK', 0, -1),
      this.createGroundLabel('LEFT', -1, 0),
    ]
  }

  private createGroundLabel(
    text: string,
    directionX: number,
    directionY: number,
  ): GroundLabel {
    const canvas = document.createElement('canvas')
    canvas.width = 512
    canvas.height = 128

    const context = canvas.getContext('2d')
    if (context) {
      context.clearRect(0, 0, canvas.width, canvas.height)
      context.fillStyle = '#c3f4ff'
      context.font = 'bold 84px "Helvetica Neue", Helvetica, Arial, sans-serif'
      context.textAlign = 'center'
      context.textBaseline = 'middle'
      context.letterSpacing = '12px'
      context.fillText(text, canvas.width / 2, canvas.height / 2)
    }

    const texture = new CanvasTexture(canvas)
    texture.colorSpace = SRGBColorSpace
    texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy()

    // The default plane lies in XY with its normal on +Z, matching the Z-up
    // ground, so the text reads upright from above without any rotation.
    const mesh = new Mesh(
      new PlaneGeometry(1, 1),
      new MeshBasicMaterial({
        map: texture,
        transparent: true,
        opacity: 0.75,
        depthWrite: false,
      }),
    )
    mesh.position.z = 0.005
    // Turn the text to sit tangentially with its top pointing out of the dome,
    // so each marker reads upright when viewed from the centre.
    mesh.rotation.z = Math.atan2(directionY, directionX) - Math.PI / 2
    mesh.renderOrder = 1
    this.scene.add(mesh)

    return { mesh, texture, directionX, directionY }
  }

  private createBeamObjects(): {
    rayLines: LineSegments
    gridLines: LineSegments
    gridPoints: Points
  } {
    // Attributes must exist before the first render, which happens before the
    // first update() fills them, so start with empty buffers drawing nothing.
    const emptyGeometry = (withColor: boolean) => {
      const geometry = new BufferGeometry()
      geometry.setAttribute('position', new BufferAttribute(new Float32Array(0), 3))
      if (withColor) {
        geometry.setAttribute('color', new BufferAttribute(new Float32Array(0), 3))
      }
      geometry.setDrawRange(0, 0)
      return geometry
    }

    const rayLines = new LineSegments(
      emptyGeometry(true),
      new LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.72,
      }),
    )
    rayLines.frustumCulled = false
    this.scene.add(rayLines)

    const gridLines = new LineSegments(
      emptyGeometry(false),
      new LineBasicMaterial({
        color: 0x8cf7e2,
        transparent: true,
        opacity: 0.72,
        depthTest: false,
      }),
    )
    gridLines.frustumCulled = false
    this.scene.add(gridLines)

    const gridPoints = new Points(
      emptyGeometry(false),
      new PointsMaterial({
        color: 0xd9fff6,
        size: 0.025,
        transparent: true,
        opacity: 0.82,
        depthTest: false,
      }),
    )
    gridPoints.frustumCulled = false
    this.scene.add(gridPoints)

    return { rayLines, gridLines, gridPoints }
  }

  /** Grows a dynamic attribute only when the ray grid needs more room than it has. */
  private ensureCapacity(
    object: LineSegments | Points | Mesh,
    current: Float32Array<ArrayBuffer>,
    vertices: number,
    name: 'position' | 'color' | 'uv',
    itemSize: 2 | 3 = 3,
  ): Float32Array<ArrayBuffer> {
    if (current.length >= vertices * itemSize) return current

    // BufferAttribute keeps the array by reference; Float32BufferAttribute
    // copies it, which would leave our writes invisible to the GPU.
    const resized = new Float32Array(vertices * itemSize)
    const attribute = new BufferAttribute(resized, itemSize)
    attribute.setUsage(DynamicDrawUsage)
    object.geometry.deleteAttribute(name)
    object.geometry.setAttribute(name, attribute)

    return resized
  }

  private writeRayBundle(rays: TracedRay[], domeRadius: number): void {
    const maxVertices = rays.length * 4
    this.rayPositions = this.ensureCapacity(
      this.rayLines,
      this.rayPositions,
      maxVertices,
      'position',
    )
    this.rayColors = this.ensureCapacity(
      this.rayLines,
      this.rayColors,
      maxVertices,
      'color',
    )

    const positions = this.rayPositions
    const colors = this.rayColors
    let offset = 0

    const pushSegment = (start: Vector3, end: Vector3, color: Color) => {
      positions[offset] = start.x
      positions[offset + 1] = start.y
      positions[offset + 2] = start.z
      positions[offset + 3] = end.x
      positions[offset + 4] = end.y
      positions[offset + 5] = end.z
      colors[offset] = color.r
      colors[offset + 1] = color.g
      colors[offset + 2] = color.b
      colors[offset + 3] = color.r
      colors[offset + 4] = color.g
      colors[offset + 5] = color.b
      offset += 6
    }

    const endpoint = new Vector3()

    for (const ray of rays) {
      const color = STATUS_COLORS[ray.status]

      if (!ray.mirrorHit) {
        endpoint
          .copy(ray.origin)
          .addScaledVector(ray.direction, domeRadius * 0.7)
        pushSegment(ray.origin, endpoint, color)
        continue
      }

      pushSegment(ray.origin, ray.mirrorHit, color)

      if (ray.domeHit) {
        pushSegment(ray.mirrorHit, ray.domeHit, color)
      } else if (ray.reflectedDirection) {
        endpoint
          .copy(ray.mirrorHit)
          .addScaledVector(ray.reflectedDirection, domeRadius * 0.8)
        pushSegment(ray.mirrorHit, endpoint, color)
      }
    }

    this.commit(this.rayLines, offset / 3, ['position', 'color'])
  }

  private writeDomeGrid(
    rays: TracedRay[],
    params: SimulationParameters,
  ): void {
    this.gridLinePositions = this.ensureCapacity(
      this.gridLines,
      this.gridLinePositions,
      rays.length * 4,
      'position',
    )
    this.gridPointPositions = this.ensureCapacity(
      this.gridPoints,
      this.gridPointPositions,
      rays.length,
      'position',
    )

    const lookup = new Map(rays.map((ray) => [`${ray.column}:${ray.row}`, ray]))
    const shrink = 1 - 0.006 / getDomeRadius(params)
    const linePositions = this.gridLinePositions
    const pointPositions = this.gridPointPositions
    let lineOffset = 0
    let pointOffset = 0

    for (const ray of rays) {
      if (!ray.domeHit) continue

      const x = ray.domeHit.x * shrink
      const y = ray.domeHit.y * shrink
      const z = ray.domeHit.z * shrink
      pointPositions[pointOffset] = x
      pointPositions[pointOffset + 1] = y
      pointPositions[pointOffset + 2] = z
      pointOffset += 3

      const right = lookup.get(`${ray.column + 1}:${ray.row}`)?.domeHit
      const below = lookup.get(`${ray.column}:${ray.row + 1}`)?.domeHit

      for (const neighbour of [right, below]) {
        if (!neighbour) continue
        linePositions[lineOffset] = x
        linePositions[lineOffset + 1] = y
        linePositions[lineOffset + 2] = z
        linePositions[lineOffset + 3] = neighbour.x * shrink
        linePositions[lineOffset + 4] = neighbour.y * shrink
        linePositions[lineOffset + 5] = neighbour.z * shrink
        lineOffset += 6
      }
    }

    this.commit(this.gridLines, lineOffset / 3, ['position'])
    this.commit(this.gridPoints, pointOffset / 3, ['position'])
  }

  /**
   * Builds a textured mesh of only the projector's valid dome footprint so the
   * preview matches FOV, pitch, lens shift, and coverage — not the whole sky.
   */
  private writeProjectedImage(
    rays: TracedRay[],
    domeRadius: number,
    orientation: SourceOrientation,
    includeOccluded: boolean,
    gridBounds: GridBounds,
    sourceProjection: SourceProjection,
  ): void {
    const columnSpan = gridBounds.maxColumn - gridBounds.minColumn
    const rowSpan = gridBounds.maxRow - gridBounds.minRow
    const maxVertices = Math.max(0, columnSpan * rowSpan * 6)
    this.projectedPositions = this.ensureCapacity(
      this.projectedImage,
      this.projectedPositions,
      maxVertices,
      'position',
      3,
    )
    this.projectedUvs = this.ensureCapacity(
      this.projectedImage,
      this.projectedUvs,
      maxVertices,
      'uv',
      2,
    )

    const lookup = new Map(rays.map((ray) => [`${ray.column}:${ray.row}`, ray]))
    const shrink = 1 - 0.008 / domeRadius
    const positions = this.projectedPositions
    const uvs = this.projectedUvs
    let vertexOffset = 0
    let uvOffset = 0

    const sample = (ray: TracedRay | undefined) => {
      if (!isMeshUsableRay(ray, includeOccluded)) return null
      const uv = directionToSourceUV(ray.domeHit, sourceProjection, orientation)
      return {
        x: ray.domeHit.x * shrink,
        y: ray.domeHit.y * shrink,
        z: ray.domeHit.z * shrink,
        u: uv.u,
        v: uv.v,
      }
    }

    const unwrapSeam = (
      a: { u: number; v: number },
      b: { u: number; v: number },
      c: { u: number; v: number },
    ) => {
      const points = [
        { u: a.u, v: a.v },
        { u: b.u, v: b.v },
        { u: c.u, v: c.v },
      ]
      const minU = Math.min(points[0].u, points[1].u, points[2].u)
      const maxU = Math.max(points[0].u, points[1].u, points[2].u)
      if (maxU - minU > 0.5) {
        for (const point of points) {
          if (point.u < 0.5) point.u += 1
        }
      }
      return points
    }

    const pushTriangle = (
      a: NonNullable<ReturnType<typeof sample>>,
      b: NonNullable<ReturnType<typeof sample>>,
      c: NonNullable<ReturnType<typeof sample>>,
    ) => {
      const seam = unwrapSeam(a, b, c)
      for (const point of [a, b, c]) {
        positions[vertexOffset] = point.x
        positions[vertexOffset + 1] = point.y
        positions[vertexOffset + 2] = point.z
        vertexOffset += 3
      }
      for (const point of seam) {
        uvs[uvOffset] = point.u
        uvs[uvOffset + 1] = point.v
        uvOffset += 2
      }
    }

    for (let row = gridBounds.minRow; row < gridBounds.maxRow; row += 1) {
      for (let column = gridBounds.minColumn; column < gridBounds.maxColumn; column += 1) {
        const topLeft = sample(lookup.get(`${column}:${row}`))
        const topRight = sample(lookup.get(`${column + 1}:${row}`))
        const bottomLeft = sample(lookup.get(`${column}:${row + 1}`))
        const bottomRight = sample(lookup.get(`${column + 1}:${row + 1}`))

        if (topLeft && topRight && bottomRight) {
          pushTriangle(topLeft, topRight, bottomRight)
        }
        if (topLeft && bottomRight && bottomLeft) {
          pushTriangle(topLeft, bottomRight, bottomLeft)
        }
      }
    }

    this.commit(this.projectedImage, vertexOffset / 3, ['position', 'uv'])
  }

  private commit(
    object: LineSegments | Points | Mesh,
    vertexCount: number,
    names: Array<'position' | 'color' | 'uv'>,
  ): void {
    for (const name of names) {
      const attribute = object.geometry.getAttribute(name)
      if (attribute) attribute.needsUpdate = true
    }
    object.geometry.setDrawRange(0, vertexCount)
  }

  readonly resize = (): void => {
    const width = this.container.clientWidth
    const height = this.container.clientHeight
    this.camera.aspect = width / Math.max(height, 1)
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(width, height, false)
  }

  private readonly onContextLost = (event: Event): void => {
    // Without preventDefault the browser will not attempt to restore the context.
    event.preventDefault()
    this.contextLossCount += 1
  }

  private readonly onContextRestored = (): void => {
    // Safari drops the context under GPU memory pressure. Coming back at a
    // lower resolution gives a repeated loss/restore cycle a chance to settle.
    this.renderer.setPixelRatio(this.targetPixelRatio())
    this.resize()
  }

  private targetPixelRatio(): number {
    const base = Math.min(window.devicePixelRatio, 2)
    return this.contextLossCount > 0 ? 1 : base
  }

  private animate = (): void => {
    // The loop must never die: rescheduling last means a single throw (Safari
    // can fail mid-frame as the context drops) would stop rendering forever.
    this.animationFrame = requestAnimationFrame(this.animate)

    const context = this.renderer.getContext()
    if (context.isContextLost()) return

    this.controls.update()
    this.renderer.render(this.scene, this.camera)
  }

  dispose(): void {
    cancelAnimationFrame(this.animationFrame)
    window.removeEventListener('resize', this.resize)
    this.renderer.domElement.removeEventListener(
      'webglcontextlost',
      this.onContextLost,
    )
    this.renderer.domElement.removeEventListener(
      'webglcontextrestored',
      this.onContextRestored,
    )

    this.clearSourceImage()
    this.projectedImageMaterial.dispose()
    for (const label of this.groundLabels) label.texture.dispose()

    const geometries = new Set<BufferGeometry>()
    const materials = new Set<Material>()

    this.scene.traverse((object: Object3D) => {
      const drawable = object as Partial<Mesh>
      if (drawable.geometry) geometries.add(drawable.geometry as BufferGeometry)
      if (drawable.material) {
        for (const material of Array.isArray(drawable.material)
          ? drawable.material
          : [drawable.material]) {
          materials.add(material as Material)
        }
      }
    })

    geometries.forEach((geometry) => geometry.dispose())
    materials.forEach((material) => material.dispose())

    this.controls.dispose()
    this.renderer.dispose()

    // Safari only allows a handful of live WebGL contexts and reclaims them
    // lazily, so hand this one back rather than waiting for garbage collection.
    this.renderer.forceContextLoss()
    this.renderer.domElement.remove()
  }
}
