import { IMAGE_WIDGET } from '@/composables/maskeditor/imageWidgetAdapter'
import { zGetMaskLayersResponse } from '@comfyorg/ingest-types/zod'
import { z } from 'zod'

import { getNodeWidgetValue } from '@/core/graph/widgets/nodeWidgetValues'
import { t } from '@/i18n'
import { useMaskEditorDataStore } from '@/stores/maskEditorDataStore'
import type { ImageRef, ImageLayer } from '@/stores/maskEditorDataStore'
import type { LGraphNode } from '@/lib/litegraph/src/litegraph'
import { useNodeOutputStore } from '@/stores/nodeOutputStore'
import { isCloud } from '@/platform/distribution/types'
import { api } from '@/scripts/api'
import { useApp } from '@/scripts/appInstance'
import { parseImageWidgetValue } from '@/utils/imageUtil'

export function extractWidgetStringValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (
    value &&
    typeof value === 'object' &&
    'filename' in value &&
    typeof value.filename === 'string'
  )
    return value.filename
  return undefined
}

// Private image utility functions
interface ImageLayerFilenames {
  maskedImage: string
  paint: string
  paintedImage: string
  paintedMaskedImage: string
}

const zLaimonMaskLayersResponse = zGetMaskLayersResponse.extend({
  subfolder: z.string().optional()
})

type MaskLayersResponse = z.infer<typeof zLaimonMaskLayersResponse>

type MaskEditorLoadResult =
  | { ok: true }
  | { ok: false; title: string; message: string }

const paintedMaskedImagePrefix = 'clipspace-painted-masked-'

function imageLayerFilenamesIfApplicable(
  inputImageFilename: string
): ImageLayerFilenames | undefined {
  const isPaintedMaskedImageFilename = inputImageFilename.startsWith(
    paintedMaskedImagePrefix
  )
  if (!isPaintedMaskedImageFilename) return undefined
  const suffix = inputImageFilename.slice(paintedMaskedImagePrefix.length)
  const timestamp = parseInt(suffix.split('.')[0], 10)
  return {
    maskedImage: `clipspace-mask-${timestamp}.png`,
    paint: `clipspace-paint-${timestamp}.png`,
    paintedImage: `clipspace-painted-${timestamp}.png`,
    paintedMaskedImage: `${paintedMaskedImagePrefix}${timestamp}.png`
  }
}

function toRef(filename: string, subfolder: string): ImageRef {
  return {
    filename,
    subfolder,
    type: 'input'
  }
}

function mkFileUrl(props: { ref: ImageRef; preview?: boolean }): string {
  const params = new URLSearchParams()
  params.set('filename', props.ref.filename)
  if (props.ref.subfolder) {
    params.set('subfolder', props.ref.subfolder)
  }
  if (props.ref.type) {
    params.set('type', props.ref.type)
  }

  const pathPlusQueryParams = api.apiURL(
    '/view?' +
      params.toString() +
      useApp().getPreviewFormatParam() +
      useApp().getRandParam()
  )
  const imageElement = new Image()
  imageElement.crossOrigin = 'anonymous'
  imageElement.src = pathPlusQueryParams
  return imageElement.src
}

export function useMaskEditorLoader() {
  const dataStore = useMaskEditorDataStore()
  const nodeOutputStore = useNodeOutputStore()

  const loadFromNode = async (
    node: LGraphNode
  ): Promise<MaskEditorLoadResult> => {
    dataStore.setLoading(true)

    try {
      validateNode(node)

      let nodeImageUrl = getNodeImageUrl(node)

      let nodeImageRef = parseImageRef(nodeImageUrl)

      const widgetFilename = extractWidgetStringValue(
        getNodeWidgetValue(node, IMAGE_WIDGET)
      )
      const parsedWidget =
        widgetFilename && !widgetFilename.startsWith('$')
          ? parseImageWidgetValue(widgetFilename)
          : undefined

      if (parsedWidget) {
        nodeImageRef = {
          filename: parsedWidget.filename,
          type: parsedWidget.type || 'input',
          subfolder: parsedWidget.subfolder || undefined
        }
      }

      if (parsedWidget) nodeImageUrl = mkFileUrl({ ref: nodeImageRef })

      const fileToQuery = widgetFilename || nodeImageRef.filename

      let maskLayersFromApi: MaskLayersResponse | undefined
      if (isCloud) {
        try {
          const response = await api.fetchApi(
            `/files/mask-layers?filename=${encodeURIComponent(fileToQuery)}`
          )
          if (response.ok) {
            maskLayersFromApi = zLaimonMaskLayersResponse.parse(
              await response.json()
            )
          }
        } catch {
          maskLayersFromApi = undefined
        }
      }

      let imageLayerFilenames = imageLayerFilenamesIfApplicable(
        nodeImageRef.filename
      )

      if (maskLayersFromApi) {
        const baseFile =
          maskLayersFromApi.mask ||
          maskLayersFromApi.painted_masked ||
          maskLayersFromApi.painted

        if (baseFile) {
          imageLayerFilenames = {
            maskedImage: baseFile,
            paint: maskLayersFromApi.paint || '',
            paintedImage: maskLayersFromApi.painted || '',
            paintedMaskedImage: maskLayersFromApi.painted_masked || baseFile
          }
        }
      }

      const layerSubfolder = maskLayersFromApi
        ? (maskLayersFromApi.subfolder ?? 'clipspace')
        : (nodeImageRef.subfolder ?? '')

      const layeredBaseUrl = imageLayerFilenames?.maskedImage
        ? mkFileUrl({
            ref: toRef(imageLayerFilenames.maskedImage, layerSubfolder)
          })
        : undefined
      const baseImageUrl = layeredBaseUrl ?? nodeImageUrl

      let paintLayerUrl: string | null = null
      if (maskLayersFromApi?.paint) {
        paintLayerUrl = mkFileUrl({
          ref: toRef(maskLayersFromApi.paint, layerSubfolder)
        })
      } else if (imageLayerFilenames?.paint) {
        paintLayerUrl = mkFileUrl({
          ref: toRef(imageLayerFilenames.paint, layerSubfolder)
        })
      }

      const loadLayers = (baseUrl: string, paintUrl: string | null) =>
        Promise.all([
          loadImageLayer(baseUrl, 'rgb'),
          loadImageLayer(baseUrl, 'a'),
          paintUrl ? loadPaintLayer(paintUrl) : Promise.resolve(undefined)
        ])

      const loadInputData = async () => {
        try {
          const [baseLayer, maskLayer, paintLayer] = await loadLayers(
            baseImageUrl,
            paintLayerUrl
          )
          return {
            baseLayer,
            maskLayer,
            paintLayer,
            sourceRef: layeredBaseUrl
              ? parseImageRef(baseImageUrl)
              : nodeImageRef
          }
        } catch (error) {
          if (!layeredBaseUrl) throw error
          console.warn(
            '[MaskEditorLoader] Failed to load editor layer files, falling back to the node image',
            error
          )
          const [baseLayer, maskLayer] = await loadLayers(nodeImageUrl, null)
          return {
            baseLayer,
            maskLayer,
            paintLayer: undefined,
            sourceRef: nodeImageRef
          }
        }
      }

      dataStore.inputData = {
        ...(await loadInputData()),
        nodeId: node.id
      }

      dataStore.sourceNode = node
      dataStore.setLoading(false)
      return { ok: true }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to load from node'
      console.error('[MaskEditorLoader]', errorMessage, error)
      dataStore.setLoading(false, errorMessage)
      return {
        ok: false,
        title: t('maskEditor.loadFailed'),
        message: errorMessage
      }
    }
  }

  function validateNode(node: LGraphNode): void {
    const hasImages = node.imgs?.length || node.previewMediaType === 'image'
    if (!hasImages) {
      throw new Error('Node has no images')
    }
  }

  function getNodeImageUrl(node: LGraphNode): string {
    if (node.images?.[0]) {
      const img = node.images[0]
      const params = new URLSearchParams({
        filename: img.filename,
        type: img.type || 'output',
        subfolder: img.subfolder || ''
      })
      return api.apiURL(`/view?${params.toString()}`)
    }

    const outputs = nodeOutputStore.getNodeOutputs(node)
    if (outputs?.images?.[0]) {
      const img = outputs.images[0]
      if (!img.filename) {
        throw new Error('nodeOutputStore image missing filename')
      }

      const params = new URLSearchParams()
      params.set('filename', img.filename)
      params.set('type', img.type || 'output')
      params.set('subfolder', img.subfolder || '')
      return api.apiURL(`/view?${params.toString()}`)
    }

    if (node.imgs?.length) {
      const index = node.imageIndex ?? 0
      const imgSrc = node.imgs[index].src

      if (imgSrc && !imgSrc.startsWith('data:')) {
        return imgSrc
      }
    }

    throw new Error('Unable to get image URL from node')
  }

  function parseImageRef(url: string): ImageRef {
    try {
      const urlObj = new URL(url)
      const filename = urlObj.searchParams.get('filename')

      if (!filename) {
        throw new Error('Image URL missing filename parameter')
      }

      return {
        filename,
        subfolder: urlObj.searchParams.get('subfolder') || undefined,
        type: urlObj.searchParams.get('type') || undefined
      }
    } catch (error) {
      try {
        const urlObj = new URL(url, window.location.origin)
        const filename = urlObj.searchParams.get('filename')

        if (!filename) {
          throw new Error('Image URL missing filename parameter', {
            cause: error
          })
        }

        return {
          filename,
          subfolder: urlObj.searchParams.get('subfolder') || undefined,
          type: urlObj.searchParams.get('type') || undefined
        }
      } catch (e) {
        throw new Error(`Invalid image URL: ${url}`, { cause: e })
      }
    }
  }

  async function loadImageLayer(
    url: string,
    channel?: 'rgb' | 'a'
  ): Promise<ImageLayer> {
    let urlObj: URL
    try {
      urlObj = new URL(url)
    } catch {
      urlObj = new URL(url, window.location.origin)
    }

    if (channel) {
      urlObj.searchParams.delete('channel')
      urlObj.searchParams.set('channel', channel)
    }

    const finalUrl = urlObj.toString()
    const image = await loadImage(finalUrl)

    return { image, url: finalUrl }
  }

  function loadImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image()
      img.crossOrigin = 'anonymous'

      img.onload = () => resolve(img)
      img.onerror = () => {
        void imageLoadFailureMessage(url).then((message) =>
          reject(new Error(message))
        )
      }

      img.src = url
    })
  }

  async function imageLoadFailureMessage(url: string): Promise<string> {
    const fallback = t('maskEditor.imageLoadFailed')
    if (import.meta.env.VITE_RUN_BILLING_MODE !== 'prepaid') return fallback
    try {
      const target = new URL(url, window.location.origin)
      const view = new URL(api.apiURL('/view'), window.location.origin)
      if (
        target.origin !== view.origin ||
        target.pathname !== view.pathname ||
        !['rgb', 'a'].includes(target.searchParams.get('channel') ?? '')
      )
        return fallback
      const response = await api.fetchApi(
        `/view?${target.searchParams.toString()}`,
        {
          signal: AbortSignal.timeout(5000),
          redirect: 'error'
        }
      )
      await response.body?.cancel()
      if (response.status === 413) return t('maskEditor.imageTooLarge')
      if (response.status === 415) return t('maskEditor.imageFormatUnsupported')
      return fallback
    } catch {
      return fallback
    }
  }

  async function loadPaintLayer(url: string): Promise<ImageLayer> {
    let urlObj: URL
    try {
      urlObj = new URL(url)
    } catch {
      urlObj = new URL(url, window.location.origin)
    }

    const finalUrl = urlObj.toString()
    const image = await loadImage(finalUrl)

    return { image, url: finalUrl }
  }

  return {
    loadFromNode
  }
}
