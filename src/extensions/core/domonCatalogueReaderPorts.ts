import type { AssetId } from '@/platform/assets/schemas/assetSchema'
import type { AssetRequestOptions } from '@/platform/assets/services/assetService'

export const DOMON_CATALOGUE_READER_PORTS_VERSION =
  'domon-comfy-catalogue-readers/v1'

export interface CatalogueReaderPorts {
  readonly version: typeof DOMON_CATALOGUE_READER_PORTS_VERSION
  readonly readerId: string
  readModelAssetPage?(
    options: AssetRequestOptions,
    context: string
  ): Promise<unknown>
  readModelAssetDetails?(id: AssetId): Promise<unknown>
  readCoreWorkflowTemplates?(locale?: string): Promise<unknown>
  readTemplateJson?(
    id: string,
    sourceModule: string,
    signal: AbortSignal
  ): Promise<unknown>
}

let installed: CatalogueReaderPorts | null = null
let generation = 0
const listeners = new Set<(generation: number) => void>()

export function currentCatalogueReaderPorts(): CatalogueReaderPorts | null {
  return installed
}

export function catalogueReaderGeneration(): number {
  return generation
}

export function subscribeCatalogueReaderPorts(
  listener: (generation: number) => void
): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function installCatalogueReaderPorts(ports: CatalogueReaderPorts): void {
  installed = ports
  generation++
  notifyListeners()
}

export function clearCatalogueReaderPorts(): void {
  if (installed === null) return
  installed = null
  generation++
  notifyListeners()
}

export function createCatalogueReaderInstaller(): (
  ports: CatalogueReaderPorts
) => () => void {
  return (ports) => {
    installCatalogueReaderPorts(ports)
    const installedAtGeneration = generation
    let disposed = false
    return () => {
      if (disposed) return
      disposed = true
      if (
        catalogueReaderGeneration() === installedAtGeneration &&
        currentCatalogueReaderPorts() === ports
      ) {
        clearCatalogueReaderPorts()
      }
    }
  }
}

function notifyListeners(): void {
  const pendingListeners = Array.from(listeners)
  for (const listener of pendingListeners) listener(generation)
}
