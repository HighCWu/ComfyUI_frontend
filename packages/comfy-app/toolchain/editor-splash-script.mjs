import { createHash } from 'node:crypto'
import { lstat, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const splashSha256 = 'adef1f99bf3aab849a477f8af4d9f1bf6bd16d5d3ead08212ab530833f241060'
export const editorSplashPath = '/scripts/domon-comfy-splash-theme.js'

export function externalEditorSplash(html) {
  if (html.includes(editorSplashPath)) throw Error('Editor splash destination already referenced')
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].filter(match =>
    createHash('sha256').update(match[1]).digest('hex') === splashSha256)
  if (scripts.length !== 1) throw Error('Expected one reviewed inline editor splash script')
  const [match] = scripts
  const entry = `<script src="${editorSplashPath}"></script>`
  return { html: html.slice(0, match.index) + entry + html.slice(match.index + match[0].length), source: match[1] }
}

// Run only on the isolated file-entry output, never on a checkout or reused artifact.
export async function externalizeBuiltEditorSplash(directory) {
  const index = resolve(directory, 'index.html')
  if (!(await lstat(index)).isFile()) throw Error('Built editor entry must be a regular file')
  const rewritten = externalEditorSplash(await readFile(index, 'utf8'))
  const scripts = resolve(directory, 'scripts')
  if (!(await lstat(scripts)).isDirectory()) throw Error('Built editor scripts must be a real directory')
  await writeFile(resolve(directory, '.' + editorSplashPath), rewritten.source, { flag: 'wx' })
  await writeFile(index, rewritten.html)
}
