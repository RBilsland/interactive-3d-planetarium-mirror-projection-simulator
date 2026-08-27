import { describe, expect, it } from 'vitest'
import { createProfileStore, MemoryStorage } from './profiles'
import type { DisplayOptions, SimulationParameters } from './types'

const parameters: SimulationParameters = {
  domeDiameter: 12,
  mirrorDiameter: 1.6,
  mirrorHeight: 0.4,
  mirrorPitch: 12,
  projectorDistance: 2,
  projectorHeight: 0.5,
  projectorPitch: -12,
  lensShiftVertical: 0.25,
  lensShiftHorizontal: 0.4,
  projectorFov: 32,
  aspectRatio: '4:3',
  gridColumns: 24,
  gridRows: 14,
}

const display: DisplayOptions = {
  showRays: false,
  showProjector: true,
  showPixelGrid: false,
  showGround: true,
  showSourcePreview: true,
  includeOccludedInMesh: false,
}

describe('saved profiles', () => {
  it('saves, lists, and reloads a named setup', () => {
    const store = createProfileStore(new MemoryStorage())
    const saved = store.save('Hall A', parameters, display)
    const listed = store.list()

    expect(listed).toHaveLength(1)
    expect(listed[0].name).toBe('Hall A')
    expect(listed[0].id).toBe(saved.id)
    expect(store.load(saved.id)?.parameters.domeDiameter).toBe(12)
    expect(store.load(saved.id)?.parameters.mirrorPitch).toBe(12)
    expect(store.load(saved.id)?.parameters.lensShiftHorizontal).toBe(0)
    expect(store.load(saved.id)?.display.showRays).toBe(false)
  })

  it('overwrites a profile of the same name', () => {
    const store = createProfileStore(new MemoryStorage())
    const first = store.save('School dome', parameters, display)
    const second = store.save('school dome', {
      ...parameters,
      domeDiameter: 16,
    }, display)

    expect(second.id).toBe(first.id)
    expect(store.list()).toHaveLength(1)
    expect(store.list()[0].name).toBe('school dome')
    expect(store.list()[0].parameters.domeDiameter).toBe(16)
  })

  it('deletes a profile that is no longer needed', () => {
    const store = createProfileStore(new MemoryStorage())
    const keep = store.save('Keep', parameters, display)
    const drop = store.save('Drop', parameters, display)

    expect(store.remove(drop.id)).toBe(true)
    expect(store.list().map((profile) => profile.id)).toEqual([keep.id])
    expect(store.load(drop.id)).toBeNull()
  })

  it('recovers from corrupt storage and fills missing fields', () => {
    const storage = new MemoryStorage()
    storage.setItem('domecast.profiles.v1', '{not json')
    const store = createProfileStore(storage)
    expect(store.list()).toEqual([])

    storage.setItem(
      'domecast.profiles.v1',
      JSON.stringify([
        {
          id: 'abc',
          name: 'Partial',
          savedAt: 1,
          parameters: { domeRadius: 7 },
          display: { showRays: false },
        },
      ]),
    )

    const loaded = store.load('abc')
    expect(loaded?.parameters.domeDiameter).toBe(14)
    expect(loaded?.parameters.mirrorDiameter).toBe(1.3)
    expect(loaded?.parameters.aspectRatio).toBe('16:9')
    expect(loaded?.display.showRays).toBe(false)
    expect(loaded?.display.showGround).toBe(true)
  })

  it('rejects a blank name', () => {
    const store = createProfileStore(new MemoryStorage())
    expect(() => store.save('   ', parameters, display)).toThrow(/name/)
  })

  it('persists source orientation and fills it for older saves', () => {
    const store = createProfileStore(new MemoryStorage())
    const saved = store.save('Oriented', parameters, display, {
      yaw: 45,
      pitch: -10,
      roll: 5,
    })
    expect(store.load(saved.id)?.orientation).toEqual({
      yaw: 45,
      pitch: -10,
      roll: 5,
    })

    const storage = new MemoryStorage()
    storage.setItem(
      'domecast.profiles.v1',
      JSON.stringify([
        {
          id: 'legacy',
          name: 'Legacy',
          savedAt: 1,
          parameters: { domeRadius: 5 },
          display: { showRays: true },
        },
      ]),
    )
    const legacy = createProfileStore(storage).load('legacy')
    expect(legacy?.orientation).toEqual({ yaw: 0, pitch: 0, roll: 0 })
    expect(legacy?.display.showSourcePreview).toBe(true)
    expect(legacy?.display.includeOccludedInMesh).toBe(false)
  })

  it('migrates v1 centre-to-centre distances to front-to-front', () => {
    const storage = new MemoryStorage()
    storage.setItem(
      'domecast.profiles.v1',
      JSON.stringify([
        {
          id: 'legacy-distance',
          name: 'Legacy distance',
          savedAt: 1,
          parameters: {
            domeRadius: 5,
            mirrorRadius: 0.65,
            projectorDistance: 1.5,
          },
          display: { showRays: true },
        },
      ]),
    )

    const store = createProfileStore(storage)
    const loaded = store.load('legacy-distance')
    expect(loaded?.parameters.projectorDistance).toBeCloseTo(0.51)
    expect(loaded?.parameters.domeDiameter).toBe(10)
    expect(loaded?.parameters.mirrorDiameter).toBeCloseTo(1.3)
    expect(storage.getItem('domecast.profiles.v3')).toBeTruthy()
    expect(storage.getItem('domecast.profiles.v1')).toBeNull()
  })

  it('migrates v2 vertical FOV to diagonal FOV', () => {
    const storage = new MemoryStorage()
    storage.setItem(
      'domecast.profiles.v2',
      JSON.stringify([
        {
          id: 'legacy-fov',
          name: 'Legacy FOV',
          savedAt: 1,
          parameters: {
            projectorFov: 28,
            aspectRatio: '16:9',
          },
          display: { showRays: true },
        },
      ]),
    )

    const store = createProfileStore(storage)
    const loaded = store.load('legacy-fov')
    expect(loaded?.parameters.projectorFov).toBeCloseTo(53.91, 1)
    expect(storage.getItem('domecast.profiles.v3')).toBeTruthy()
    expect(storage.getItem('domecast.profiles.v2')).toBeNull()
  })
})
