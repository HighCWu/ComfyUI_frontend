# Build the DomonAI ComfyUI raw editor

This package is for the raw editor, not the whole DomonAI site. It includes
ComfyUI frontend `d80e51113ebbac1bb2bd0e4c2e3ad2e7454a38ae` and the required
raw build inputs from adapter commit `53e248460dd4bcbaf7caacf189afd9689cf83689`.
Keep the directory layout intact. See `packages/frontend/LICENSE`,
`packages/frontend/THIRD_PARTY_NOTICES.md`, and `docs/licenses/` for notices.
The nine identified fonts listed in `RAW_SOURCE_PREPARATION.json` are excluded.
The package does not include the standalone shell, embedded extension, backend,
site configuration, or any service credentials.

Run from a freshly extracted package on Linux with Node 26.8.2 and pnpm 11.13.1.
The first install may download the locked dependencies, but must not run dependency
scripts. The recorded build used a previously populated store and ran offline.
Run the build in a clean environment without project credentials or .env files.

```sh
set -eu
root="$PWD"
work="$(mktemp -d)"
mkdir "$work/home" "$work/tmp" "$work/empty-env"
node_bin="$(command -v node)"
pnpm_bin="$(command -v pnpm)"
clean_path="$(dirname "$node_bin"):$(dirname "$pnpm_bin"):/usr/bin:/bin"
cd "$root/packages/frontend"
env -i PATH="$clean_path" HOME="$work/home" TMPDIR="$work/tmp" CI=1 \
  "$pnpm_bin" install --frozen-lockfile --ignore-scripts
env -i PATH="$clean_path" HOME="$work/home" TMPDIR="$work/tmp" CI=1 \
  NODE_ENV=production DISTRIBUTION=cloud npm_package_version=1.58.0 \
  FRONTEND_COMMIT_HASH=d80e51113ebbac1bb2bd0e4c2e3ad2e7454a38ae \
  VITE_RUN_BILLING_MODE=prepaid VITE_AGENT_BACKEND_MODE=disabled \
  ENABLE_MINIFY=true GENERATE_SOURCEMAP=true ANALYZE_BUNDLE=false DISABLE_VUE_PLUGINS=true \
  SENTRY_DISABLE_TELEMETRY=1 SENTRY_AUTH_TOKEN= DOTENV_KEY= \
  DOMON_COMFY_RAW_OUT_DIR="$work/raw-editor" DOMON_COMFY_RAW_CACHE_DIR="$work/cache" \
  DOMON_COMFY_RAW_ENV_DIR="$work/empty-env" DOMON_COMFY_FILE_ENTRY=1 \
  "$node_bin" node_modules/vite/bin/vite.js build \
  --config "$root/packages/comfy-app/toolchain/frontend.vite.config.mts" --mode production
cd "$root"
"$node_bin" --input-type=module - "$work/raw-editor" <<'JS'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { externalizeBuiltEditorSplash } from './packages/comfy-app/toolchain/editor-splash-script.mjs'
import { comfyPublicSnapshotFiles } from './packages/api/scripts/comfy-public-snapshot.mjs'
const directory = process.argv[2]
await externalizeBuiltEditorSplash(directory)
const files = comfyPublicSnapshotFiles(directory, { allowRawDiagnostics: true }).sort()
const digest = createHash('sha256')
for (const file of files) {
  const sha = createHash('sha256').update(await readFile(resolve(directory, file))).digest('hex')
  digest.update(JSON.stringify([file, sha]) + '\n')
}
console.log(files.length, digest.digest('hex'))
JS
```

The recorded raw public projection excludes diagnostic source maps and has
1,064 files, digest `cd19b7f1a556c3d0e7e4a50fd4a3122f0b5213d97300f2404f9d59540739adc1`.
Raw build Vite and Rolldown versions were 8.2.2 and 1.2.6, respectively.
This build explicitly excludes dependency directories from Tailwind's class
scan while still using the locked dependencies to compile and bundle the editor.
An exit from Vite alone does not establish that the projection matches.
