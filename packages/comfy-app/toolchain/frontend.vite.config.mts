import { isAbsolute } from 'node:path'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { defineConfig, mergeConfig } from '../../frontend/node_modules/vite/dist/node/index.js'
import frontendConfig from '../../frontend/vite.config.mts'
import { boundFileEntryTailwindSources, fileEntryPreloadDependencies, load3dLazySourcePath, tailwindEntrySourcePath, transformEditorSessionUrlSourceForFileEntry,
  transformLoad3dLazySourceForFileEntry, transformRouterSourceForFileEntry } from './editor-file-entry-adapter.ts'
import { transformPricingModule } from '../../api/scripts/editor-node-pricing-adapter.mjs'
import { normalizeRawFrontendFontFace, readRawFrontendResources } from './frontend-resources.ts'
import { openFontSources, transformOpenFonts } from './open-fonts.ts'

const output = process.env.DOMON_COMFY_RAW_OUT_DIR
const cache = process.env.DOMON_COMFY_RAW_CACHE_DIR
const environment = process.env.DOMON_COMFY_RAW_ENV_DIR
if (!output || !cache || !environment || ![output, cache, environment].every(isAbsolute))
  throw new Error('Run the App-owned raw frontend builder with isolated absolute directories')

// SPEC 0140 file-entry profile, explicit opt-in only (`DOMON_COMFY_FILE_ENTRY=1`,
// set by frontend-build.ts when `fileEntry: true`). Default off: the plugin is
// not registered at all, so legacy raw output behavior stays unchanged. When on,
// three exact source seams are transformed in-memory before bundling
// (never written back to the frontend checkout); any drifted anchor fails the
// build loudly via the transform functions themselves.
const fileEntryProfile = process.env.DOMON_COMFY_FILE_ENTRY === '1'
const tailwindEntry = fileURLToPath(new URL('../../frontend/' + tailwindEntrySourcePath, import.meta.url)).replaceAll('\\', '/')
const upstreamPreload = frontendConfig.build?.modulePreload
const resolveUpstreamPreload = upstreamPreload && typeof upstreamPreload === 'object' ? upstreamPreload.resolveDependencies : undefined
if (fileEntryProfile && !resolveUpstreamPreload) throw Error('Missing upstream ComfyUI HTML preload resolver')

const fileEntryTailwindSources = {
  name: 'comfy-app-bound-tailwind-sources',
  enforce: 'pre' as const,
  transform: {
    order: 'pre' as const,
    handler(code: string, id: string) {
      if (id.replaceAll('\\', '/') !== tailwindEntry) return null
      return { code: boundFileEntryTailwindSources(code), map: null }
    },
  },
}

const fileEntrySourceAdapter = () => ({
  name: 'comfy-app-file-entry-source-adapter',
  enforce: 'pre',
  transform(code: string, id: string) {
    const path = id.split('?')[0].replace(/\\/g, '/')
    if (path.endsWith('/src/router.ts')) return { code: transformRouterSourceForFileEntry(code).source, map: null }
    if (path.endsWith('/src/scripts/editorSessionUrl.ts')) {
      return { code: transformEditorSessionUrlSourceForFileEntry(code).source, map: null }
    }
    if (path.endsWith('/' + load3dLazySourcePath)) {
      return { code: transformLoad3dLazySourceForFileEntry(code), map: null }
    }
    return null
  },
})

export default defineConfig(mergeConfig(frontendConfig, {
  base: '/',
  envDir: environment,
  cacheDir: cache,
  build: { outDir: output, emptyOutDir: true, sourcemap: 'hidden', license: { fileName: 'assets/licenses/bundled-dependencies.txt' },
    ...(fileEntryProfile && resolveUpstreamPreload ? {
      modulePreload: { resolveDependencies: (file, deps, context) =>
        fileEntryPreloadDependencies(context.hostType, deps, () => resolveUpstreamPreload(file, deps, context)) },
    } : {}),
  },
  plugins: [
    {
      name: 'comfy-app-open-fonts',
      enforce: 'pre',
      async load(id: string) {
        const path = id.split('?')[0]!.replaceAll('\\', '/')
        if (!openFontSources.some(source => path.endsWith('/' + source))) return null
        return { code: transformOpenFonts(await readFile(path, 'utf8'), path)!, map: null }
      },
    },
    {
      name: 'comfy-app-static-resources',
      transformIndexHtml() {
        return [{ tag: 'link', attrs: { rel: 'license', type: 'text/plain', href: '/assets/licenses/NOTICE.txt' } }]
      },
      async generateBundle() {
        for (const { fileName, source } of await readRawFrontendResources())
          this.emitFile({ type: 'asset', fileName, source })
      },
      async writeBundle() {
        await normalizeRawFrontendFontFace(output)
      },
    },
    ...(fileEntryProfile ? [fileEntryTailwindSources, fileEntrySourceAdapter()] : []),
    {
      name: 'comfy-app-platform-pricing',
      enforce: 'pre',
      transform(code, id) { return transformPricingModule(code, id) },
    },
  ],
}))
