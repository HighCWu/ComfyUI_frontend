// @ts-check
import { cpSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { assertNoComfyInlineSourceMap, isComfySourceMapCarrier } from './comfy-inline-source-map.mjs';

/** @param {string} root @param {string} path */
function classify(root, path) {
  const name = relative(root, path);
  const stat = lstatSync(path);
  if (!stat.isDirectory() && !stat.isFile())
    throw new Error(`Unexpected file type in ComfyUI snapshot: ${name || '.'}`);
  const diagnostic = /\.map$/i.test(name) || name === 'frontend-build.json';
  return { diagnostic, directory: stat.isDirectory() };
}

/** Validate and list regular public files. Work only inside the Comfy subtree.
 * @param {string} source @param {{ allowRawDiagnostics?: boolean }} [options] */
export function comfyPublicSnapshotFiles(source, options = {}) {
  const root = resolve(source);
  /** @type {string[]} */
  const files = [];
  /** @param {string} path */
  function walk(path) {
    const kind = classify(root, path);
    if (kind.diagnostic) {
      if (!options.allowRawDiagnostics) throw new Error(`ComfyUI diagnostic in public snapshot: ${relative(root, path)}`);
      return;
    }
    if (kind.directory) for (const entry of readdirSync(path).sort()) walk(resolve(path, entry));
    else {
      const name = relative(root, path);
      if (isComfySourceMapCarrier(name)) assertNoComfyInlineSourceMap(name, readFileSync(path));
      files.push(name);
    }
  }
  if (!classify(root, root).directory) throw new Error('ComfyUI snapshot must be a directory');
  walk(root);
  return files;
}

/** @param {string} source @param {string} destination */
export function copyComfyPublicSnapshot(source, destination) {
  const from = resolve(source), to = resolve(destination);
  if (from === to || from.startsWith(to + sep) || to.startsWith(from + sep))
    throw new Error('ComfyUI snapshot source and destination must be separate');
  comfyPublicSnapshotFiles(from, { allowRawDiagnostics: true });
  const target = lstatSync(to, { throwIfNoEntry: false });
  if (target && (!target.isDirectory() || readdirSync(to).length))
    throw new Error('ComfyUI public snapshot destination must be empty');
  cpSync(from, to, { recursive: true, filter: path => !classify(from, path).diagnostic });
}
