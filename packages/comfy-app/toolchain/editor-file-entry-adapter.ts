/**
 * Narrow source transforms for the SPEC 0140 file entry `/comfyUI.html`
 * (case fixed): assembly-time navigation and startup transforms over the TEXT of
 * pinned frontend sources, producing transformed source for the App build.
 * The frontend checkout is never modified; raw/dist artifacts, the existing
 * vite config and the router history implementation are never touched.
 *
 * Router seams (frontend fork 0d59817155 `src/router.ts`):
 *
 *   1. `file-entry-document-guard` — after `src/router.ts:52`
 *      (`const isFileProtocol = …`): capture the document's initial path and
 *      flag captured file-document mode (`window.location.pathname === entry`).
 *   2. `graphview-route-alias` — at `src/router.ts:88-91` (the route named
 *      `GraphView`): register the entry document as a route alias ONLY in
 *      captured file mode, so the first document URL (with query and hash)
 *      resolves to the editor root.
 *   3. `file-entry-root-navigation-guard` — before `src/router.ts:122`
 *      (`installPreservedQueryTracker(router, …)`, i.e. ahead of the
 *      preserved-query/auth guards): in captured file mode ONLY, an early
 *      guard maps `to.path === '/'` to the entry document carrying the
 *      navigation's own query and hash with `replace: true`. Later root
 *      navigations (user-select, cloud signup, subscription redirects,
 *      unmatched redirect) therefore stay on `/comfyUI.html` instead of
 *      leaving the editor document. Inert outside captured file mode.
 *
 * Session seam (`src/scripts/editorSessionUrl.ts:25`): extend the compiled
 * `['/', '/comfy/']` pathname allowlist of `updateEditorSessionNavigation`
 * with the exact entry path so eds_ `client_id` renewal/removal keeps
 * working on the file entry. The existing client_id-presence requirement and
 * validation/removal logic are preserved verbatim.
 *
 * The router base (`src/router.ts:61-81`) stays `'/'` and the history
 * implementation is untouched: no `/comfyUI.html/` subpath family, no
 * monkeypatching. Any source whose anchors do not match exactly (exactly
 * once each, not already transformed) is loudly refused.
 */

export const EDITOR_FILE_ENTRY_PATH = '/comfyUI.html'

export type FileEntrySeamName =
  | 'file-entry-document-guard'
  | 'graphview-route-alias'
  | 'file-entry-root-navigation-guard'
  | 'editor-session-whitelist'

export interface FileEntrySourceTransform {
  /** The transformed source text. */
  source: string
  entryPath: string
  /** Seams applied, in application order. */
  applied: FileEntrySeamName[]
}

/** Refusal with the exact unsupported shape. */
export class UnsupportedShapeError extends Error {
  readonly scope: string
  readonly detail: string

  constructor(scope: string, detail: string) {
    super(`editor-file-entry-adapter: unsupported shape at ${scope}: ${detail}`)
    this.name = 'UnsupportedShapeError'
    this.scope = scope
    this.detail = detail
  }
}

const ENTRY_PATH_SHAPE = /^\/[A-Za-z][A-Za-z0-9._-]*\.html$/

/** `src/router.ts:52` — the guard declares captured file-document mode right after it. */
const ROUTER_GUARD_ANCHOR = `const isFileProtocol = window.location.protocol === 'file:'`

/** `src/router.ts:88-91` — the GraphView child route receives the alias. */
const GRAPHVIEW_ALIAS_ANCHOR = [
  `          path: '',`,
  `          name: 'GraphView',`,
  `          component: () => import('@/views/GraphView.vue'),`
].join('\n')

/** `src/router.ts:122` — the root-navigation guard installs ahead of it. */
const ROOT_NAVIGATION_GUARD_ANCHOR = `installPreservedQueryTracker(router, PRESERVED_QUERY_DEFINITIONS)`

/** `src/scripts/editorSessionUrl.ts:25` — the pathname allowlist literal. */
const SESSION_WHITELIST_ANCHOR = `['/', '/comfy/']`

const LOAD3D_IMPORTS = ['load3d', 'load3dAdvanced', 'load3dPreviewExtensions',
  'saveMesh', 'cameraInfo', 'cameraAngle', 'lightInfo'] as const
export const load3dLazySourcePath = 'src/extensions/core/load3dLazy.ts'

const countOccurrences = (source: string, needle: string): number =>
  needle === '' ? 0 : source.split(needle).length - 1

const applyOnce = (source: string, scope: string, anchor: string, inserted: string, occurrences: number): string => {
  if (occurrences !== 1) {
    throw new UnsupportedShapeError(scope, `expected the anchor exactly once, found ${occurrences} occurrence(s)`)
  }
  return source.replace(anchor, inserted)
}

/** SPEC 0196: retain deferred imports and the original shared promise and
 * hook replay, but wait for each of the seven pinned imports in order. */
export function transformLoad3dLazySourceForFileEntry(source: string): string {
  const anchor = [
    '    await Promise.all([',
    LOAD3D_IMPORTS.map(name => `      import('./${name}')`).join(',\n'),
    '    ])',
  ].join('\n')
  return applyOnce(source, load3dLazySourcePath, anchor,
    LOAD3D_IMPORTS.map(name => `    await import('./${name}')`).join('\n'), countOccurrences(source, anchor))
}

/** Preserve the upstream HTML resolver. Vite appends the dynamic CSS
 * dependencies outside this callback; retain CSS if also supplied here. */
export function fileEntryPreloadDependencies(hostType: 'html' | 'js', deps: string[], html: () => string[]): string[] {
  return hostType === 'html' ? html() : deps.filter(dep => dep.endsWith('.css'))
}

function requireEntryPath(entryPath: string): string {
  if (!ENTRY_PATH_SHAPE.test(entryPath)) {
    throw new UnsupportedShapeError(
      'entry-path',
      `expected a single-segment path like '/comfyUI.html', got '${entryPath}'`
    )
  }
  return entryPath
}

/**
 * Transform the router source: captured file-document mode flag, the
 * GraphView entry alias, and the root-navigation guard that keeps
 * `router.push('/')` on the entry document (preserving that navigation's
 * query and hash). Pure text in / text out; throws
 * {@link UnsupportedShapeError} when the source does not match the pinned
 * anchors exactly.
 */
export function transformRouterSourceForFileEntry(
  source: string,
  entryPath: string = EDITOR_FILE_ENTRY_PATH
): FileEntrySourceTransform {
  requireEntryPath(entryPath)
  if (source.includes('FILE_ENTRY_DOCUMENT_PATH') || source.includes('isFileEntryDocument')) {
    throw new UnsupportedShapeError('already-transformed', 'the router source already carries the file-entry transform')
  }

  let output = applyOnce(
    source,
    'router-source:file-entry-document-guard',
    ROUTER_GUARD_ANCHOR,
    [
      ROUTER_GUARD_ANCHOR,
      ``,
      `const FILE_ENTRY_DOCUMENT_PATH = '${entryPath}'`,
      `const isFileEntryDocument = window.location.pathname === FILE_ENTRY_DOCUMENT_PATH`
    ].join('\n'),
    countOccurrences(source, ROUTER_GUARD_ANCHOR)
  )
  output = applyOnce(
    output,
    'router-source:graphview-route-alias',
    GRAPHVIEW_ALIAS_ANCHOR,
    [
      `          path: '',`,
      `          name: 'GraphView',`,
      `          alias: isFileEntryDocument ? FILE_ENTRY_DOCUMENT_PATH : [],`,
      `          component: () => import('@/views/GraphView.vue'),`
    ].join('\n'),
    countOccurrences(source, GRAPHVIEW_ALIAS_ANCHOR)
  )
  output = applyOnce(
    output,
    'router-source:file-entry-root-navigation-guard',
    ROOT_NAVIGATION_GUARD_ANCHOR,
    [
      `if (isFileEntryDocument) {`,
      `  router.beforeEach((to) => {`,
      `    if (to.path === '/') {`,
      `      return { path: FILE_ENTRY_DOCUMENT_PATH, query: to.query, hash: to.hash, replace: true }`,
      `    }`,
      `  })`,
      `}`,
      ``,
      ROOT_NAVIGATION_GUARD_ANCHOR
    ].join('\n'),
    countOccurrences(source, ROOT_NAVIGATION_GUARD_ANCHOR)
  )

  return {
    source: output,
    entryPath,
    applied: ['file-entry-document-guard', 'graphview-route-alias', 'file-entry-root-navigation-guard'],
  }
}

/**
 * Extend the `updateEditorSessionNavigation` pathname allowlist with the
 * exact entry document path. Existing client_id presence/validation/removal
 * logic is preserved verbatim; arbitrary filename paths are not permitted.
 */
export function transformEditorSessionUrlSourceForFileEntry(
  source: string,
  entryPath: string = EDITOR_FILE_ENTRY_PATH
): FileEntrySourceTransform {
  requireEntryPath(entryPath)
  if (source.includes(entryPath)) {
    throw new UnsupportedShapeError('already-transformed', 'the session source already carries the file-entry transform')
  }
  const whitelistInserted = `['/', '/comfy/', '${entryPath}']`
  return {
    source: applyOnce(
      source,
      'session-source:editor-session-whitelist',
      SESSION_WHITELIST_ANCHOR,
      whitelistInserted,
      countOccurrences(source, SESSION_WHITELIST_ANCHOR)
    ),
    entryPath,
    applied: ['editor-session-whitelist'],
  }
}

export const tailwindEntrySourcePath = 'src/assets/css/style.css'
const excludeTailwindDependencies = '@source not "../../../**/node_modules/**";'

/** The upstream workspace supplies the editor's utility class candidates.
 * Prevent Oxide from walking the installed dependency tree in an archive.
 */
export function boundFileEntryTailwindSources(source: string): string {
  const designSystemImport = '@import \'@comfyorg/design-system/css/style.css\';'
  if (countOccurrences(source, designSystemImport) !== 1 || source.includes(excludeTailwindDependencies))
    throw new UnsupportedShapeError('tailwind-scan-source', 'expected the unmodified main Tailwind stylesheet')
  return source + '\n' + excludeTailwindDependencies + '\n'
}
