# ComfyUI Frontend (DomonAI fork)

This repository is the public source delivery of the **ComfyUI web frontend,
as forked and maintained by [DomonAI](https://domon.ai/)**. It contains the
complete, buildable source of the frontend editor — no backend, no deployment
configuration, and no proprietary service code.

## Fork relationship

- **Upstream project:** [Comfy-Org/ComfyUI_frontend](https://github.com/Comfy-Org/ComfyUI_frontend)
  (the official front end of [ComfyUI](https://github.com/comfyanonymous/ComfyUI)).
- **Base version:** upstream `v1.58.0` (see `package.json`), plus DomonAI
  platform integration changes kept as small and reviewable as possible.
- Upstream remains authoritative for generic frontend development; fixes that
  are not DomonAI-specific are contributed upstream first. Upstream's
  [CONTRIBUTING.md](CONTRIBUTING.md) describes the shared development
  conventions.

## DomonAI-specific differences from upstream

The current fork delta is intentionally narrow. The one substantive change at
this delivery is a font-rights cleanup (`chore(fonts): replace restricted
PPFormula fonts with Inter family`):

- All 9 proprietary `PPFormula` `woff2` faces were removed from the tree
  (6 previously in `apps/website/public/fonts/`, 3 previously in
  `src/platform/cloud/onboarding/assets/fonts/`).
- Display/UI typography now resolves to the existing **Inter** family
  (OFL-licensed, see [License](#license)). Two Inter latin subsets ship at
  `public/fonts/` and are mirrored byte-identically in
  `apps/website/public/fonts/`:

  | File                                    | SHA-256                                                            |
  | --------------------------------------- | ------------------------------------------------------------------ |
  | `public/fonts/inter-latin-normal.woff2` | `2c295d99e26dcf357d4d01bcf270fd6924b600c9a13dd8c363ef114f4c6976fa` |
  | `public/fonts/inter-latin-italic.woff2` | `c58f9d530baa7e96355f444502eca739d5eefa0f328f3d635b73648373214629` |

- All `PPFormula` `@font-face` blocks and the narrow-font CSS token were
  deleted; the `--font-formula` token now resolves to Inter.
- The onboarding font stylesheet was reduced to a single comment
  (`DomonAI uses the existing Inter family; no proprietary font URLs.`), and
  the e2e specs that asserted proprietary font metrics/preloads were removed.
- The `exclude-proprietary-fonts` Vite guard in `vite.config.mts` is retained:
  any `PPFormula`/`ABCROM` font file still referenced by name is dropped from
  non-cloud bundles.

## Requirements

- **Node.js** `>=26.8.2 <27` (see `package.json` `engines`; `.nvmrc` pins `26`)
- **pnpm** `>=11.3` — `packageManager` pins `pnpm@11.13.1`; with Corepack:
  `corepack enable`

## Build from source (minimal)

```sh
pnpm install --frozen-lockfile
pnpm build
```

`pnpm build` runs the TypeScript typecheck and then the Vite production build
(`vite build --config vite.config.mts`). The output lands in `dist/`
(`index.html`, `assets/`, `fonts/`, `build-manifest.json`, …). The default
distribution target is `localhost`; `pnpm build:cloud` and
`pnpm build:desktop-dist` select the other targets.

Other useful scripts (see `package.json` for the full list): `pnpm dev`
(dev server), `pnpm test:unit`, `pnpm lint`, `pnpm typecheck`.

## Reproducible build

1. **Dependency lock.** The full dependency graph is pinned by
   `pnpm-lock.yaml` together with the `catalog:` pins in
   `pnpm-workspace.yaml`. Always install with `--frozen-lockfile`; any
   lockfile drift is a bug, not a resolution to update.
2. **Commit identity.** Every build writes `dist/build-manifest.json`:

   ```json
   { "commit": "<40-hex commit>", "distribution": "localhost" }
   ```

   The `commit` value resolves in priority order: the `FRONTEND_COMMIT_HASH`
   environment variable → `git rev-parse HEAD` → `"unknown"`. Because the
   frontend source lives at `packages/frontend/` as a plain directory of this
   delivered tree (not a git submodule), always set `FRONTEND_COMMIT_HASH`
   explicitly to the pinned frontend commit from the delivery receipt at the
   repository root (`RAW_SOURCE_PREPARATION.json` / `SOURCE_DELIVERY.json`,
   field `frontendCommit`), then compare it against `build-manifest.json`
   after building.

## Cloner verification checklist

From the repository root of a fresh anonymous clone:

```sh
git clone https://git.aiapp.run/domon-ai/comfyui-frontend.git
cd comfyui-frontend

# 1. Read the pinned frontend commit from the delivery receipt.
PIN=$(grep -oE '"frontendCommit": ?"[0-9a-f]{40}"' *.json | head -1 | grep -oE '[0-9a-f]{40}')
echo "$PIN"

# 2. Spot-check delivered source digests against the receipt's fileSha256 map
#    (every delivered file is listed there; the three license texts and the two
#    Inter fonts are quoted above and below).
sha256sum packages/frontend/LICENSE packages/frontend/THIRD_PARTY_NOTICES.md \
  packages/frontend/src/lib/litegraph/LICENSE packages/frontend/public/fonts/*.woff2

# 3. Locked install and pinned-commit build.
cd packages/frontend
pnpm install --frozen-lockfile
FRONTEND_COMMIT_HASH="$PIN" pnpm build

# 4. Build-manifest commit self-check.
cat dist/build-manifest.json
# The "commit" field must equal $PIN exactly.

# 5. No proprietary fonts in the artifact.
find dist -iname '*PPFormula*' -o -iname '*ABCROM*' | wc -l   # must print 0
ls dist/fonts/   # exactly inter-latin-normal.woff2, inter-latin-italic.woff2,
                 # materialdesignicons-webfont.woff2
```

Pinned digests for step 2:

```text
3972dc9744f6499f0f9b2dbf76696f2ae7ad8af9b23dde66d6af86c9dfb36986  LICENSE (GPL-3.0)
99d8402cda1959b3055ffeb30b7f12cde0d44a5d6835e741619399c780bca715  THIRD_PARTY_NOTICES.md
1b38cc30fe774bcc77538ab99eb460f4e1c8a47c4fddc6e991ee3b5cc2a96bb9  src/lib/litegraph/LICENSE
```

## License

- The frontend source is distributed under the **GNU General Public License
  v3** — see [LICENSE](LICENSE) (`package.json` declares `GPL-3.0-only`).
- [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) carries required third-party
  notices (AMD trademark).
- `src/lib/litegraph/LICENSE` covers the bundled litegraph code (MIT).
- The repository-root `docs/licenses/` directory carries the license texts for
  redistributed font/icon assets: Inter (SIL Open Font License 1.1,
  `inter-66647c0bb-LICENSE.txt`), Material Design Icons (Pictogrammers Free
  License, `mdi-v7.4.47-LICENSE.txt`) and the Apache-2.0 text
  (`Apache-2.0.txt`).

If you redistribute this program or a build of it, keep these license and
notice files intact alongside the source or artifact, as their respective
licenses require.

## Delivered tree layout

The delivery keeps monorepo-relative paths, rooted at the repository root:

```text
packages/frontend/            this frontend source (this README lives here)
docs/licenses/                font/icon license texts for redistributed assets
RAW_SOURCE_PREPARATION.json   delivery receipt: plan pins + per-file SHA-256
                              (or SOURCE_DELIVERY.json in later generations)
```

The repository root also carries the contracted delivery/build adapter scripts
(the frontend build toolchain and the editor node pricing adapter). Their exact
paths are listed in the root receipt; they are the only non-frontend files in
the delivery, and none of them contain server, deployment, or routing code.
