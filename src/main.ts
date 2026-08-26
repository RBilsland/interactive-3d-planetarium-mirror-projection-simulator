import GUI from 'lil-gui'
import './style.css'
import { PlanetariumScene } from './scene/PlanetariumScene'
import { createProfileStore } from './simulation/profiles'
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

const display: DisplayOptions = {
  showRays: true,
  showProjector: true,
  showPixelGrid: true,
  showGround: true,
  showSourcePreview: true,
  includeOccludedInMesh: false,
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
        <div id="gui-container"></div>
        <section class="source-panel" aria-label="Equirectangular source">
          <p class="eyebrow">Equirectangular source</p>
          <div class="source-actions">
            <label class="file-button" for="source-file">
              Choose image
              <input id="source-file" type="file" accept="image/*" hidden />
            </label>
            <button id="source-clear" type="button">Clear</button>
          </div>
          <p id="source-status" class="profile-status" role="status">
            No image loaded · recommended 4096×2048 (2:1)
          </p>
          <button id="download-mesh" type="button" class="mesh-download">
            Download warp mesh
          </button>
        </section>
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
        <div class="hint">
          <span>⌘</span>
          <p><strong>Navigate the model</strong><br>Drag to orbit · Scroll to zoom · Right-drag to pan</p>
        </div>
      </aside>

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
const gui = new GUI({
  container: document.querySelector<HTMLElement>('#gui-container')!,
  title: '',
  width: 300,
})

let updateFrame = 0
const scheduleUpdate = () => {
  cancelAnimationFrame(updateFrame)
  updateFrame = requestAnimationFrame(updateSimulation)
}

const bind = (controller: ReturnType<GUI['add']>) =>
  controller.onChange(scheduleUpdate)

const geometryFolder = gui.addFolder('Environment')
bind(geometryFolder.add(params, 'domeRadius', 2.5, 10, 0.1).name('Dome radius · m'))
bind(geometryFolder.add(params, 'mirrorRadius', 0.2, 1.5, 0.01).name('Mirror radius · m'))
bind(geometryFolder.add(params, 'mirrorHeight', 0, 3.5, 0.05).name('Mirror height · m'))

const projectorFolder = gui.addFolder('Projector')
bind(projectorFolder.add(params, 'projectorDistance', 0.75, 4, 0.05).name('Mirror distance · m'))
bind(projectorFolder.add(params, 'projectorHeight', 0, 3.5, 0.05).name('Height · m'))
bind(projectorFolder.add(params, 'projectorPitch', -30, 30, 0.25).name('Pitch · °'))
bind(projectorFolder.add(params, 'projectorFov', 10, 75, 0.5).name('Vertical FOV · °'))
bind(projectorFolder.add(params, 'aspectRatio', ['16:9', '16:10', '4:3']).name('Aspect ratio'))

const lensFolder = gui.addFolder('Lens shift')
bind(lensFolder.add(params, 'lensShiftVertical', -1, 1, 0.01).name('Vertical · image heights'))

const orientationFolder = gui.addFolder('Source orientation')
bind(orientationFolder.add(orientation, 'yaw', -180, 180, 0.5).name('Yaw · °'))
bind(orientationFolder.add(orientation, 'pitch', -180, 180, 0.5).name('Pitch · °'))
bind(orientationFolder.add(orientation, 'roll', -180, 180, 0.5).name('Roll · °'))

const displayFolder = gui.addFolder('Viewport layers')
bind(displayFolder.add(display, 'showRays').name('Ray bundle'))
bind(displayFolder.add(display, 'showProjector').name('Projector chassis'))
bind(displayFolder.add(display, 'showPixelGrid').name('Dome pixel grid'))
bind(displayFolder.add(display, 'showGround').name('Ground plane'))
bind(displayFolder.add(display, 'showSourcePreview').name('Source preview'))
bind(
  displayFolder
    .add(display, 'includeOccludedInMesh')
    .name('Include occluded in mesh'),
)

const defaults = { ...params }
const defaultOrientation = { ...orientation }
const profiles = createProfileStore()
const profileName = document.querySelector<HTMLInputElement>('#profile-name')!
const profileStatus = document.querySelector<HTMLElement>('#profile-status')!
const profileList = document.querySelector<HTMLElement>('#profile-list')!
const sourceStatus = document.querySelector<HTMLElement>('#source-status')!
const sourceFile = document.querySelector<HTMLInputElement>('#source-file')!

const applyControllers = () => {
  gui.controllersRecursive().forEach((controller) => controller.updateDisplay())
}

const setProfileStatus = (message: string) => {
  profileStatus.textContent = message
}

const setSourceStatus = (message: string) => {
  sourceStatus.textContent = message
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
    params.lensShiftHorizontal = 0
    profileName.value = loaded.name
    applyControllers()
    scheduleUpdate()
    renderProfileList(loaded.id)
    setProfileStatus(
      `Loaded “${loaded.name}”. Re-select the equirectangular image if needed.`,
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
    const ratio = size.width / Math.max(1, size.height)
    const ratioOk = Math.abs(ratio - 2) < 0.05
    const resolutionHint =
      size.width === 4096 && size.height === 2048
        ? '4K equirectangular'
        : `${size.width}×${size.height}`
    setSourceStatus(
      ratioOk
        ? `Loaded ${resolutionHint}`
        : `Loaded ${resolutionHint} · expected ~2:1 aspect`,
    )
    scheduleUpdate()
  } catch {
    setSourceStatus('Could not load that image.')
  } finally {
    sourceFile.value = ''
  }
})

document.querySelector('#source-clear')!.addEventListener('click', () => {
  scene.clearSourceImage()
  setSourceStatus('No image loaded · recommended 4096×2048 (2:1)')
  scheduleUpdate()
})

document.querySelector('#download-mesh')!.addEventListener('click', () => {
  const mesh = buildWarpMesh(params, {
    orientation,
    includeOccluded: display.includeOccludedInMesh,
  })
  const text = serializeWarpMesh(mesh)
  const filename = sanitizeMeshFilename(profileName.value || 'domecast_equirect')
  downloadWarpMesh(text, filename)
  setSourceStatus(`Downloaded ${filename} (${mesh.columns}×${mesh.rows})`)
})

renderProfileList()

function updateSimulation(): void {
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
    gui.destroy()
  })
}
