import GUI from 'lil-gui'
import './style.css'
import { PlanetariumScene } from './scene/PlanetariumScene'
import type { ViewMode } from './scene/PlanetariumScene'
import { createProfileStore } from './simulation/profiles'
import {
  getMaxProjectorDistance,
} from './simulation/rayTracer'
import {
  buildSetupExport,
  downloadSetupExport,
  parseSetupExport,
  sanitizeSetupFilename,
  serializeSetupExport,
} from './simulation/setupExport'
import {
  buildWarpMesh,
  downloadWarpMesh,
  sanitizeMeshFilename,
  serializeWarpMesh,
} from './simulation/warpMesh'
import type {
  DisplayOptions,
  SimulationParameters,
  SourceOrientation,
} from './simulation/types'

const params: SimulationParameters = {
  domeDiameter: 10,
  mirrorDiameter: 1.3,
  mirrorHeight: 1.15,
  mirrorPitch: 0,
  projectorDistance: 0.51,
  projectorHeight: 1.15,
  projectorPitch: 0,
  lensShiftVertical: 0,
  lensShiftHorizontal: 0,
  projectorFov: 54,
  aspectRatio: '16:9',
  gridColumns: 32,
  gridRows: 18,
}

const display: DisplayOptions = {
  showRays: true,
  showProjector: true,
  showPixelGrid: true,
  showGround: true,
  showSourcePreview: true,
  showApexMarker: false,
  excludeOccludedFromMesh: true,
}

const orientation: SourceOrientation = {
  yaw: 0,
  pitch: 0,
  roll: 0,
}

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <main class="app-shell">
    <header class="topbar">
      <div class="brand">
        <span class="brand-mark" aria-hidden="true">
          <i></i><i></i><i></i>
        </span>
        <div>
          <p class="eyebrow">Optical design workspace</p>
          <h1>DomeCast <span>Simulator</span></h1>
        </div>
      </div>
      <div class="status-pill">
        <span class="pulse"></span>
        Real-time ray trace
      </div>
    </header>

    <section class="workspace">
      <aside class="control-panel">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">Scene parameters</p>
            <h2>Optical setup</h2>
          </div>
          <button id="reset-parameters" class="icon-button" title="Reset parameters" aria-label="Reset parameters">↺</button>
        </div>
        <div class="tab-strip" role="tablist" aria-label="Control groups">
          <button
            id="tab-rig"
            class="tab is-active"
            type="button"
            role="tab"
            aria-selected="true"
            aria-controls="panel-rig"
            data-panel="panel-rig"
          >
            Rig
          </button>
          <button
            id="tab-source"
            class="tab"
            type="button"
            role="tab"
            aria-selected="false"
            aria-controls="panel-source"
            data-panel="panel-source"
          >
            Source
          </button>
          <button
            id="tab-export"
            class="tab"
            type="button"
            role="tab"
            aria-selected="false"
            aria-controls="panel-export"
            data-panel="panel-export"
          >
            Export
          </button>
          <button
            id="tab-setups"
            class="tab"
            type="button"
            role="tab"
            aria-selected="false"
            aria-controls="panel-setups"
            data-panel="panel-setups"
          >
            Setups
          </button>
        </div>

        <div class="tab-panels">
          <div
            id="panel-rig"
            class="tab-panel is-active"
            role="tabpanel"
            aria-labelledby="tab-rig"
          >
            <div id="gui-rig" class="gui-mount"></div>
          </div>

          <div
            id="panel-source"
            class="tab-panel"
            role="tabpanel"
            aria-labelledby="tab-source"
            hidden
          >
            <section class="source-panel" aria-label="Dome source image">
              <p class="eyebrow">Dome source image</p>
              <div class="source-actions">
                <label class="file-button" for="source-file">
                  Choose image
                  <input id="source-file" type="file" accept="image/*" hidden />
                </label>
                <button id="source-clear" type="button">Clear</button>
              </div>
              <p id="source-status" class="profile-status" role="status">
                No image loaded · 1:1 fisheye or 2:1 equirectangular
              </p>
            </section>
            <div id="gui-source" class="gui-mount"></div>
          </div>

          <div
            id="panel-export"
            class="tab-panel"
            role="tabpanel"
            aria-labelledby="tab-export"
            hidden
          >
            <section class="panel-section" aria-label="Export">
              <p class="eyebrow">Warp mesh</p>
              <button id="download-mesh" type="button" class="mesh-download">
                Download warp mesh
              </button>
            </section>
            <section class="panel-section" aria-label="Setup file">
              <p class="eyebrow">Setup file</p>
              <label class="mesh-download" for="import-setup">
                Import setup JSON
                <input id="import-setup" type="file" accept="application/json,.json" hidden />
              </label>
              <button id="export-setup" type="button" class="mesh-download">
                Export setup JSON
              </button>
            </section>
            <p id="export-status" class="profile-status" role="status"></p>
          </div>

          <div
            id="panel-setups"
            class="tab-panel"
            role="tabpanel"
            aria-labelledby="tab-setups"
            hidden
          >
            <section class="profiles" aria-label="Saved setups">
              <p class="eyebrow">Saved setups</p>
              <div class="profile-save-row">
                <input
                  id="profile-name"
                  type="text"
                  maxlength="80"
                  placeholder="Name this setup"
                  autocomplete="off"
                />
                <button id="profile-save" type="button">Save</button>
              </div>
              <p id="profile-status" class="profile-status" role="status"></p>
              <ul id="profile-list" class="profile-list"></ul>
            </section>
          </div>
        </div>

        <div class="hint">
          <span>⌘</span>
          <p><strong>Navigate the model</strong><br>Drag to orbit · Scroll to zoom · Right-drag to pan</p>
        </div>
      </aside>

      <div
        id="panel-resizer"
        class="panel-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize control panel"
        tabindex="0"
        title="Drag to resize · double-click to reset"
      ></div>

      <section class="viewport-wrap">
        <div id="viewport" aria-label="Interactive 3D planetarium simulation"></div>
        <div class="axis-label rear">−Y · MIRROR</div>
        <div class="axis-label front">+Y · DOME</div>

        <div class="analytics-card">
          <p class="eyebrow">Live analysis</p>
          <div class="metric-primary">
            <div>
              <strong id="coverage-value">0.0%</strong>
              <span>Dome coverage</span>
            </div>
            <svg class="coverage-ring" viewBox="0 0 48 48" aria-hidden="true">
              <circle cx="24" cy="24" r="19"></circle>
              <circle id="coverage-ring" class="ring-value" cx="24" cy="24" r="19"></circle>
            </svg>
          </div>
          <div class="metric-row">
            <span>Projector fill</span>
            <strong id="fill-value">0.0%</strong>
          </div>
          <div class="metric-row">
            <span>Mirror use</span>
            <strong id="mirror-use-value">0.0%</strong>
          </div>
          <div class="metric-row">
            <span>Beam clearance</span>
            <strong id="clearance-value">0.00 m</strong>
          </div>
          <div class="metric-row">
            <span>Self-shadowing</span>
            <strong id="shadow-value" class="metric-status clear"><i></i> Clear</strong>
          </div>
          <div class="ray-counts">
            <span><i class="valid"></i><b id="valid-count">0</b> valid</span>
            <span><i class="missed"></i><b id="missed-count">0</b> overshot</span>
            <span><i class="occluded"></i><b id="occluded-count">0</b> occluded</span>
          </div>
        </div>

        <div class="view-card">
          <div class="view-card-heading">
            <p class="eyebrow">View</p>
            <button
              id="view-collapse"
              class="view-collapse"
              type="button"
              aria-expanded="true"
              aria-controls="gui-view"
              title="Collapse view controls"
            >
              −
            </button>
          </div>
          <div id="gui-view" class="gui-mount"></div>
        </div>

        <div class="legend">
          <span><i class="valid"></i> Valid path</span>
          <span><i class="missed"></i> Overshot</span>
          <span><i class="occluded"></i> Chassis shadow</span>
        </div>
      </section>
    </section>
  </main>
`

const viewport = document.querySelector<HTMLElement>('#viewport')!
const scene = new PlanetariumScene(viewport)
const mountGui = (selector: string) =>
  new GUI({
    container: document.querySelector<HTMLElement>(selector)!,
    title: '',
    width: 300,
  })

const rigGui = mountGui('#gui-rig')
const sourceGui = mountGui('#gui-source')
const viewGui = mountGui('#gui-view')
const guis = [rigGui, sourceGui, viewGui]

let updateFrame = 0
const scheduleUpdate = () => {
  cancelAnimationFrame(updateFrame)
  updateFrame = requestAnimationFrame(updateSimulation)
}

const bind = (controller: ReturnType<GUI['add']>) =>
  controller.onChange(scheduleUpdate)

const geometryFolder = rigGui.addFolder('Environment')
bind(geometryFolder.add(params, 'domeDiameter', 5, 20, 0.1).name('Dome diameter · m'))
const mirrorDiameterController = bind(
  geometryFolder.add(params, 'mirrorDiameter', 0.4, 3, 0.02).name('Mirror diameter · m'),
)
mirrorDiameterController.domElement.classList.add('group-start')
bind(geometryFolder.add(params, 'mirrorHeight', 0, 3.5, 0.05).name('Mirror height · m'))
bind(geometryFolder.add(params, 'mirrorPitch', 0, 60, 0.25).name('Mirror pitch down · °'))

const projectorFolder = rigGui.addFolder('Projector')
bind(projectorFolder.add(params, 'aspectRatio', ['16:9', '16:10', '4:3']).name('Aspect ratio'))
const distanceController = bind(
  projectorFolder
    .add(params, 'projectorDistance', 0, getMaxProjectorDistance(params), 0.05)
    .name('Mirror distance · m'),
)
bind(projectorFolder.add(params, 'projectorHeight', 0, 3.5, 0.05).name('Height · m'))
bind(projectorFolder.add(params, 'projectorPitch', -30, 30, 0.25).name('Pitch · °'))
bind(projectorFolder.add(params, 'projectorFov', 20, 120, 0.5).name('Diagonal FOV · °'))
bind(
  projectorFolder
    .add(params, 'lensShiftVertical', -1, 1, 0.01)
    .name('Vertical lens shift'),
)

const syncProjectorDistanceRange = (): void => {
  const maxDistance = getMaxProjectorDistance(params)
  distanceController.max(Math.max(maxDistance, 0.05))
  params.projectorDistance = Math.min(
    Math.max(0, params.projectorDistance),
    maxDistance,
  )
  distanceController.updateDisplay()
}

bind(
  sourceGui.add(display, 'excludeOccludedFromMesh').name('Exclude occluded from mesh'),
)

const orientationFolder = sourceGui.addFolder('Source orientation')
const yawController = bind(
  orientationFolder.add(orientation, 'yaw', -180, 180, 0.5).name('Yaw · °'),
)
const pitchController = bind(
  orientationFolder.add(orientation, 'pitch', -180, 180, 0.5).name('Pitch · °'),
)
const rollController = bind(
  orientationFolder.add(orientation, 'roll', -180, 180, 0.5).name('Roll · °'),
)

const setOrientationControls = (
  mode: 'off' | 'fisheye' | 'equirectangular',
): void => {
  if (mode === 'off') {
    yawController.disable()
    pitchController.disable()
    rollController.disable()
    return
  }

  yawController.enable()
  if (mode === 'fisheye') {
    orientation.pitch = 0
    orientation.roll = 0
    pitchController.updateDisplay()
    rollController.updateDisplay()
    pitchController.disable()
    rollController.disable()
    return
  }

  pitchController.enable()
  rollController.enable()
}
setOrientationControls('off')

const view = { mode: 'fly' as ViewMode }
viewGui
  .add(view, 'mode', { Fly: 'fly', 'Inside dome': 'dome' })
  .name('Camera')
  .onChange((mode: ViewMode) => applyViewMode(mode))

const displayFolder = viewGui.addFolder('Viewport layers')
const layerControllers = {
  showRays: bind(displayFolder.add(display, 'showRays').name('Ray bundle')),
  showProjector: bind(
    displayFolder.add(display, 'showProjector').name('Projector chassis'),
  ),
  showPixelGrid: bind(
    displayFolder.add(display, 'showPixelGrid').name('Dome pixel grid'),
  ),
  showGround: bind(displayFolder.add(display, 'showGround').name('Ground plane')),
  showSourcePreview: bind(
    displayFolder.add(display, 'showSourcePreview').name('Source preview'),
  ),
  showApexMarker: bind(
    displayFolder.add(display, 'showApexMarker').name('Dome apex'),
  ),
}

// The apex ring only means anything from the centre of the dome, so it stays
// off and locked until the observer goes inside.
layerControllers.showApexMarker.disable()

/** Layers the dome view forces while the observer is inside the dome. */
const DOME_VIEW_LAYERS: Partial<DisplayOptions> = {
  showRays: false,
  showPixelGrid: false,
  showGround: true,
  showSourcePreview: true,
}

let flyLayers: DisplayOptions | null = null

/**
 * Re-asserts the locked layers so anything that writes to `display` while the
 * observer is inside the dome (loading a source or a saved setup) cannot switch
 * the ray bundle or pixel grid back on underneath them.
 */
const enforceViewLayers = (): void => {
  if (view.mode !== 'dome') return
  Object.assign(display, DOME_VIEW_LAYERS)
  for (const key of Object.keys(DOME_VIEW_LAYERS) as (keyof typeof layerControllers)[]) {
    layerControllers[key].disable()
  }
}

/** Layer state to fall back to when the observer leaves the dome view. */
const rememberFlyLayers = (layers: DisplayOptions): void => {
  if (view.mode === 'dome') flyLayers = { ...layers }
}

const applyViewMode = (mode: ViewMode): void => {
  if (mode === 'dome') {
    if (!flyLayers) flyLayers = { ...display }
    enforceViewLayers()
    // Unlike the locked layers, the apex ring becomes the observer's to choose,
    // starting on each time they step inside.
    display.showApexMarker = true
    layerControllers.showApexMarker.enable()
  } else {
    if (flyLayers) {
      Object.assign(display, flyLayers)
      flyLayers = null
    }
    for (const controller of Object.values(layerControllers)) {
      controller.enable()
    }
    display.showApexMarker = false
    layerControllers.showApexMarker.disable()
  }

  scene.setViewMode(mode)
  applyControllers()
  scheduleUpdate()
}

const defaults = { ...params }
const defaultOrientation = { ...orientation }
const profiles = createProfileStore()
const profileName = document.querySelector<HTMLInputElement>('#profile-name')!
const profileStatus = document.querySelector<HTMLElement>('#profile-status')!
const profileList = document.querySelector<HTMLElement>('#profile-list')!
const sourceStatus = document.querySelector<HTMLElement>('#source-status')!
const sourceFile = document.querySelector<HTMLInputElement>('#source-file')!

const applyControllers = () => {
  for (const instance of guis) {
    instance.controllersRecursive().forEach((controller) => controller.updateDisplay())
  }
}

const setProfileStatus = (message: string) => {
  profileStatus.textContent = message
}

const setSourceStatus = (message: string) => {
  sourceStatus.textContent = message
}

const exportStatus = document.querySelector<HTMLElement>('#export-status')!
const setExportStatus = (message: string) => {
  exportStatus.textContent = message
}

const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')

const renderProfileList = (activeId = ''): void => {
  const saved = profiles.list()
  if (saved.length === 0) {
    profileList.innerHTML =
      '<li class="profile-empty">No saved setups yet</li>'
    return
  }

  profileList.innerHTML = saved
    .map((profile) => {
      const when = new Date(profile.savedAt).toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
      const active = profile.id === activeId ? ' is-active' : ''
      return `
        <li class="profile-item${active}" data-id="${profile.id}">
          <div>
            <strong>${escapeHtml(profile.name)}</strong>
            <span>${escapeHtml(when)}</span>
          </div>
          <div class="profile-actions">
            <button type="button" data-action="load">Load</button>
            <button type="button" data-action="delete">Delete</button>
          </div>
        </li>
      `
    })
    .join('')
}

const PANEL_WIDTH_STORAGE_KEY = 'domecast.panelWidth'
const DEFAULT_PANEL_WIDTH = 322
const MIN_PANEL_WIDTH = 260
const MAX_PANEL_WIDTH = 620

const workspace = document.querySelector<HTMLElement>('.workspace')!
const controlPanel = document.querySelector<HTMLElement>('.control-panel')!
const panelResizer = document.querySelector<HTMLElement>('#panel-resizer')!

/** Leaves at least 45% of the workspace for the viewport on smaller screens. */
const clampPanelWidth = (width: number): number =>
  Math.round(
    Math.min(
      Math.max(width, MIN_PANEL_WIDTH),
      Math.min(MAX_PANEL_WIDTH, workspace.clientWidth * 0.55),
    ),
  )

const setPanelWidth = (width: number): void => {
  workspace.style.setProperty('--panel-width', `${clampPanelWidth(width)}px`)
  scene.resize()
}

try {
  const stored = Number(localStorage.getItem(PANEL_WIDTH_STORAGE_KEY))
  if (Number.isFinite(stored) && stored > 0) setPanelWidth(stored)
} catch {
  // A blocked localStorage just means the panel opens at its default width.
}

const persistPanelWidth = (): void => {
  try {
    localStorage.setItem(PANEL_WIDTH_STORAGE_KEY, String(controlPanel.clientWidth))
  } catch {
    // Ignored: the width simply will not survive a reload.
  }
}

panelResizer.addEventListener('pointerdown', (event) => {
  event.preventDefault()
  panelResizer.setPointerCapture(event.pointerId)
  panelResizer.classList.add('is-dragging')
  document.body.style.userSelect = 'none'
})

panelResizer.addEventListener('pointermove', (event) => {
  if (!panelResizer.hasPointerCapture(event.pointerId)) return
  setPanelWidth(event.clientX - workspace.getBoundingClientRect().left)
})

const endPanelDrag = (event: PointerEvent): void => {
  if (!panelResizer.hasPointerCapture(event.pointerId)) return
  panelResizer.releasePointerCapture(event.pointerId)
  panelResizer.classList.remove('is-dragging')
  document.body.style.userSelect = ''
  persistPanelWidth()
}

panelResizer.addEventListener('pointerup', endPanelDrag)
panelResizer.addEventListener('pointercancel', endPanelDrag)

panelResizer.addEventListener('dblclick', () => {
  setPanelWidth(DEFAULT_PANEL_WIDTH)
  persistPanelWidth()
})

panelResizer.addEventListener('keydown', (event) => {
  const step = event.key === 'ArrowLeft' ? -16 : event.key === 'ArrowRight' ? 16 : 0
  if (step === 0) return
  event.preventDefault()
  setPanelWidth(controlPanel.clientWidth + step)
  persistPanelWidth()
})

const tabs = [...document.querySelectorAll<HTMLButtonElement>('.tab-strip .tab')]

const selectTab = (panelId: string): void => {
  for (const tab of tabs) {
    const active = tab.dataset.panel === panelId
    tab.classList.toggle('is-active', active)
    tab.setAttribute('aria-selected', String(active))
    const panel = document.querySelector<HTMLElement>(`#${tab.dataset.panel}`)!
    panel.classList.toggle('is-active', active)
    panel.hidden = !active
  }
}

for (const tab of tabs) {
  tab.addEventListener('click', () => selectTab(tab.dataset.panel!))
}

const viewCollapse = document.querySelector<HTMLButtonElement>('#view-collapse')!
viewCollapse.addEventListener('click', () => {
  const collapsed = viewCollapse.getAttribute('aria-expanded') === 'true'
  viewCollapse.setAttribute('aria-expanded', String(!collapsed))
  viewCollapse.textContent = collapsed ? '+' : '−'
  viewCollapse.title = collapsed ? 'Expand view controls' : 'Collapse view controls'
  document
    .querySelector<HTMLElement>('.view-card')!
    .classList.toggle('is-collapsed', collapsed)
})

document.querySelector('#reset-parameters')!.addEventListener('click', () => {
  Object.assign(params, defaults)
  Object.assign(orientation, defaultOrientation)
  params.lensShiftHorizontal = 0
  applyControllers()
  scheduleUpdate()
})

document.querySelector('#profile-save')!.addEventListener('click', () => {
  const name = profileName.value.trim()
  if (!name) {
    setProfileStatus('Enter a name before saving.')
    profileName.focus()
    return
  }

  try {
    const saved = profiles.save(name, params, display, orientation)
    profileName.value = saved.name
    renderProfileList(saved.id)
    setProfileStatus(`Saved “${saved.name}”.`)
  } catch (error) {
    setProfileStatus(
      error instanceof Error ? error.message : 'Could not save that setup.',
    )
  }
})

profileName.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault()
    document.querySelector<HTMLButtonElement>('#profile-save')!.click()
  }
})

profileList.addEventListener('click', (event) => {
  const target = (event.target as HTMLElement).closest('button')
  if (!target) return
  const item = target.closest<HTMLElement>('.profile-item')
  if (!item) return

  const id = item.dataset.id
  if (!id) return

  if (target.dataset.action === 'load') {
    const loaded = profiles.load(id)
    if (!loaded) {
      setProfileStatus('That setup could not be found.')
      renderProfileList()
      return
    }

    Object.assign(params, loaded.parameters)
    Object.assign(display, loaded.display)
    Object.assign(orientation, loaded.orientation)
    // Inside the dome the saved layers wait until the observer flies back out.
    rememberFlyLayers(loaded.display)
    enforceViewLayers()
    params.lensShiftHorizontal = 0
    profileName.value = loaded.name
    applyControllers()
    scheduleUpdate()
    renderProfileList(loaded.id)
    setProfileStatus(
      `Loaded “${loaded.name}”. Re-select the source image if needed.`,
    )
    return
  }

  if (target.dataset.action === 'delete') {
    const name = item.querySelector('strong')?.textContent ?? 'setup'
    profiles.remove(id)
    if (profileName.value === name) profileName.value = ''
    renderProfileList()
    setProfileStatus(`Deleted “${name}”.`)
  }
})

sourceFile.addEventListener('change', async () => {
  const file = sourceFile.files?.[0]
  if (!file) return

  try {
    const size = await scene.setSourceImage(file)
    const resolutionHint = `${size.width}×${size.height}`
    const kindHint =
      size.projection === 'fisheye'
        ? 'fisheye'
        : 'equirectangular'
    setSourceStatus(`Loaded ${resolutionHint} · ${kindHint}`)
    // A new image starts from a neutral orientation rather than inheriting the
    // angles that suited the previous one.
    Object.assign(orientation, defaultOrientation)
    setOrientationControls(size.projection)
    applyControllers()
    scheduleUpdate()
  } catch (error) {
    setOrientationControls('off')
    if (error instanceof Error && error.message === 'INVALID_SOURCE_ASPECT') {
      setSourceStatus(
        'Invalid source image · use a 1:1 fisheye or 2:1 equirectangular image',
      )
    } else {
      setSourceStatus('Could not load that image.')
    }
  } finally {
    sourceFile.value = ''
  }
})

document.querySelector('#source-clear')!.addEventListener('click', () => {
  scene.clearSourceImage()
  setOrientationControls('off')
  setSourceStatus('No image loaded · 1:1 fisheye or 2:1 equirectangular')
  scheduleUpdate()
})

const importSetup = document.querySelector<HTMLInputElement>('#import-setup')!
importSetup.addEventListener('change', async () => {
  const file = importSetup.files?.[0]
  if (!file) return

  try {
    const imported = parseSetupExport(await file.text())
    Object.assign(params, imported.parameters)
    Object.assign(orientation, imported.orientation)
    display.excludeOccludedFromMesh = imported.excludeOccludedFromMesh
    // Inside the dome the imported layers wait until the observer flies back out.
    enforceViewLayers()
    profileName.value = imported.name
    applyControllers()
    scheduleUpdate()
    setExportStatus(
      `Imported “${imported.name}”. Re-select the source image if needed.`,
    )
  } catch (error) {
    setExportStatus(
      error instanceof Error && error.message === 'UNSUPPORTED_SETUP_FORMAT'
        ? 'Not a DomeCast setup file.'
        : 'Could not read that setup file.',
    )
  } finally {
    importSetup.value = ''
  }
})

document.querySelector('#export-setup')!.addEventListener('click', () => {
  const name = profileName.value.trim() || 'Untitled setup'
  const setup = buildSetupExport(name, params, display, orientation)
  const filename = sanitizeSetupFilename(name)
  downloadSetupExport(serializeSetupExport(setup), filename)
  setExportStatus(`Exported ${filename} for Metal / external runtimes`)
})

document.querySelector('#download-mesh')!.addEventListener('click', () => {
  const sourceProjection = scene.getSourceProjection() ?? 'equirectangular'
  const mesh = buildWarpMesh(params, {
    orientation,
    includeOccluded: !display.excludeOccludedFromMesh,
    sourceProjection,
  })
  const text = serializeWarpMesh(mesh)
  const fallbackName =
    sourceProjection === 'fisheye' ? 'domecast_fisheye' : 'domecast_equirect'
  const filename = sanitizeMeshFilename(profileName.value || fallbackName)
  downloadWarpMesh(text, filename)
  setExportStatus(
    `Downloaded ${filename} (${mesh.columns}×${mesh.rows}, ${mesh.nodes.filter((node) => node.intensity > 0).length} mapped)`,
  )
})

renderProfileList()

function updateSimulation(): void {
  syncProjectorDistanceRange()
  enforceViewLayers()
  const result = scene.update(params, display, orientation)
  const coverage = result.coveragePercent
  document.querySelector('#coverage-value')!.textContent = `${coverage.toFixed(1)}%`
  document.querySelector<SVGCircleElement>('#coverage-ring')!.style.strokeDashoffset =
    String(119.38 * (1 - coverage / 100))
  document.querySelector('#fill-value')!.textContent =
    `${result.mirrorHitPercent.toFixed(1)}%`
  document.querySelector('#mirror-use-value')!.textContent =
    `${result.mirrorUsePercent.toFixed(1)}%`

  const clearance = document.querySelector<HTMLElement>('#clearance-value')!
  clearance.textContent =
    result.beamClearance >= 2
      ? 'Beam clear'
      : `${result.beamClearance >= 0 ? '+' : ''}${result.beamClearance.toFixed(2)} m`
  clearance.style.color = result.beamClearance > 0 ? '#58e6c2' : '#ff4d8d'
  document.querySelector('#valid-count')!.textContent = String(result.validCount)
  document.querySelector('#missed-count')!.textContent = String(result.missedCount)
  document.querySelector('#occluded-count')!.textContent = String(result.occludedCount)

  const shadow = document.querySelector<HTMLElement>('#shadow-value')!
  shadow.className = `metric-status ${result.shadowOccluded ? 'blocked' : 'clear'}`
  shadow.innerHTML = result.shadowOccluded
    ? '<i></i> Occluded'
    : '<i></i> Clear'
}

updateSimulation()

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    scene.dispose()
    for (const instance of guis) instance.destroy()
  })
}
