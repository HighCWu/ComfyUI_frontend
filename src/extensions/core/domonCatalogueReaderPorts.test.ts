import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  DOMON_CATALOGUE_READER_PORTS_VERSION,
  catalogueReaderGeneration,
  clearCatalogueReaderPorts,
  createCatalogueReaderInstaller,
  currentCatalogueReaderPorts,
  installCatalogueReaderPorts,
  subscribeCatalogueReaderPorts
} from './domonCatalogueReaderPorts'

import type { CatalogueReaderPorts } from './domonCatalogueReaderPorts'

function buildPorts(readerId = 'reader-a'): CatalogueReaderPorts {
  return {
    version: DOMON_CATALOGUE_READER_PORTS_VERSION,
    readerId,
    readModelAssetPage: vi.fn(async () => ({ assets: [] }))
  }
}

describe('catalogue reader ports slot', () => {
  afterEach(() => {
    clearCatalogueReaderPorts()
  })

  it('starts empty and exposes nothing before an install', () => {
    expect(currentCatalogueReaderPorts()).toBeNull()
  })

  it('returns the installed ports and bumps the generation on every install', () => {
    const baseline = catalogueReaderGeneration()
    const first = buildPorts('reader-a')
    installCatalogueReaderPorts(first)
    expect(currentCatalogueReaderPorts()).toBe(first)
    expect(catalogueReaderGeneration()).toBe(baseline + 1)

    const second = buildPorts('reader-a')
    installCatalogueReaderPorts(second)
    expect(currentCatalogueReaderPorts()).toBe(second)
    expect(catalogueReaderGeneration()).toBe(baseline + 2)
  })

  it('clears the slot and keeps counting generations afterwards', () => {
    const baseline = catalogueReaderGeneration()
    installCatalogueReaderPorts(buildPorts())
    clearCatalogueReaderPorts()
    expect(currentCatalogueReaderPorts()).toBeNull()
    expect(catalogueReaderGeneration()).toBe(baseline + 2)
    clearCatalogueReaderPorts()
    expect(catalogueReaderGeneration()).toBe(baseline + 2)
  })

  it('notifies subscribers with the new generation on install and clear', () => {
    const baseline = catalogueReaderGeneration()
    const seen: number[] = []
    const unsubscribe = subscribeCatalogueReaderPorts((generation) => {
      seen.push(generation)
    })

    installCatalogueReaderPorts(buildPorts())
    clearCatalogueReaderPorts()
    unsubscribe()
    installCatalogueReaderPorts(buildPorts())

    expect(seen).toEqual([baseline + 1, baseline + 2])
  })

  it('starts newly subscribed listeners on the next notification', () => {
    const seen: string[] = []
    let removeLate: (() => void) | undefined
    const removeEarly = subscribeCatalogueReaderPorts(() => {
      seen.push('early')
      removeLate = subscribeCatalogueReaderPorts(() => seen.push('late'))
      removeEarly()
    })
    try {
      installCatalogueReaderPorts(buildPorts())
      expect(seen).toEqual(['early'])
      clearCatalogueReaderPorts()
      expect(seen).toEqual(['early', 'late'])
    } finally {
      removeEarly()
      removeLate?.()
    }
  })
})

describe('createCatalogueReaderInstaller', () => {
  afterEach(() => {
    clearCatalogueReaderPorts()
  })

  it('installs and its dispose revokes its own installation', () => {
    const baseline = catalogueReaderGeneration()
    const install = createCatalogueReaderInstaller()
    const ports = buildPorts()

    const dispose = install(ports)
    expect(currentCatalogueReaderPorts()).toBe(ports)

    dispose()
    expect(currentCatalogueReaderPorts()).toBeNull()
    expect(catalogueReaderGeneration()).toBe(baseline + 2)
  })

  it('keeps a newer installation alive when a stale dispose runs', () => {
    const install = createCatalogueReaderInstaller()
    const staleDispose = install(buildPorts('reader-a'))
    const kept = buildPorts('reader-b')

    install(kept)
    staleDispose()

    expect(currentCatalogueReaderPorts()).toBe(kept)
  })

  it('stops a stale dispose from clearing a reinstalled identical ports object', () => {
    const baseline = catalogueReaderGeneration()
    const install = createCatalogueReaderInstaller()
    const ports = buildPorts('reader-a')

    const staleDispose = install(ports)
    staleDispose()
    install(ports)
    staleDispose()

    expect(currentCatalogueReaderPorts()).toBe(ports)
    expect(catalogueReaderGeneration()).toBe(baseline + 3)
  })

  it('makes a dispose inert after its first run', () => {
    const baseline = catalogueReaderGeneration()
    const install = createCatalogueReaderInstaller()
    const dispose = install(buildPorts())

    dispose()
    dispose()

    expect(currentCatalogueReaderPorts()).toBeNull()
    expect(catalogueReaderGeneration()).toBe(baseline + 2)
  })
})
