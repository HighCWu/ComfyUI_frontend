// Editor badge adapter data — platform settlement display values for API nodes.
//
// SPEC 0137: the native editor's per-node pricing badge evaluates the upstream
// Comfy Cloud `price_badge` declaration with Comfy Cloud's credit rate
// (CREDITS_PER_USD = 211), which is a foreign currency and a different amount
// from what DomonAI actually debits. This module carries the platform's flat
// per-class_type settlement values for the editor badge display.
//
// Single source of truth: `CREDITS_PER_CLASS_TYPE` in
// src/lib/api-workflow/nodes/registry.ts — the billing authority enforced by
// the queue consumer at settlement time. This copy exists so the editor build
// override (comfy-vite-override.config.mts) can serialize the values into the
// client bundle without pulling the whole registry handler graph into the vite
// config. Drift is impossible to ship silently: the contract test
// src/lib/api-workflow/__tests__/editor-node-pricing-adapter.contract.test.ts
// fails the packages/api suite if this map ever differs from the registry.
//
// Display contract (SPEC 0137):
//   - class_type in the map            → `$0.09/Run · platform settlement`
//     (the suffix is locale-aware since night round 5, R5 copy fix 1: the
//     editor's existing vue-i18n locale drives it — zh renders
//     `$0.09/次 · 平台计价`, everything else keeps the English suffix; the
//     adapter owns the badge copy wholesale, no upstream locale file changes)
//   - api_node not in the map          → '' (suppress: no per-node price exists
//     on this platform — unregistered api-node workflows fall back to prepaid
//     GPU session time billing, and Comfy Cloud's credits price never applies)
//   - non-api node                     → null (fall through to upstream behavior)

/**
 * Frozen copy of `CREDITS_PER_CLASS_TYPE` (milli-credits per executed call;
 * 1 milli-credit = $0.0000001, see src/lib/credits.ts). Pinned to the registry
 * by the contract test — keep in lockstep.
 */
export const EDITOR_API_NODE_SETTLEMENT_MILLICREDITS = Object.freeze({
  OpenAIDalle2: 300_000,
  OpenAIDalle3: 600_000,
  FluxProUltraImageNode: 900_000,
  GeminiImageNode: 600_000,
  GeminiImage2Node: 600_000,
  IdeogramV4: 600_000,
  IdeogramV1: 600_000,
  IdeogramV2: 600_000,
  RecraftTextToImageNode: 600_000,
  RecraftV4TextToImageNode: 600_000,
  RecraftImageToImageNode: 600_000,
  LumaImageNode2: 600_000,
  LumaImageEditNode2: 600_000,
  LumaImageModifyNode: 600_000,
  WanTextToImageApi: 600_000,
  WanImageToImageApi: 600_000,
  GrokImageNode: 600_000,
  GrokImageEditNodeV2: 600_000,
  OpenAIGPTImageNodeV2: 600_000,
  ByteDanceSeedreamNodeV2: 600_000,
  Krea2ImageNode: 600_000,
  StabilityStableImageUltraNode: 600_000,
  StabilityStableImageSD_3_5Node: 600_000,
  ReveImageCreateNode: 600_000,
  ReveImageEditNode: 600_000,
  ReveImageRemixNode: 600_000,
  RunwayTextToImageNode: 600_000,
  KlingImageGenerationNode: 600_000,
  Flux2ProImageNode: 600_000,
  Flux2MaxImageNode: 600_000,
  Flux2ImageNode: 600_000,
  FluxKontextProImageNode: 600_000,
  FluxKontextMaxImageNode: 600_000,
  OpenAIChatNode: 20_000,
  ClaudeNode: 20_000,
  GeminiNode: 20_000,
  GeminiNodeV2: 20_000,
  ByteDanceSeedNode: 20_000,
  OpenRouterLLMNode: 20_000,
  OpenAIChatConfig: 0,
});

const MILLICREDITS_PER_USD = 10_000_000;

/**
 * Format milli-credits as a compact USD string (900_000 → `$0.09`,
 * 20_000 → `$0.002`, 0 → `$0`). Integer division avoids float drift.
 */
export const formatPlatformSettlementUsd = (millicredits) => {
  if (!Number.isInteger(millicredits) || millicredits < 0) return null
  const fixed = (millicredits / MILLICREDITS_PER_USD).toFixed(4)
  const trimmed = fixed.replace(/0+$/, '').replace(/\.$/, '')
  return `$${trimmed === '' ? '0' : trimmed}`
}

/**
 * Badge decision function (mirrored into the client bundle by
 * {@link platformBadgeHelperSource}; that copy is the one the editor runs).
 *
 * @param {string} name node class_type from the node definition
 * @param {boolean} isApiNode whether the node definition is an api_node
 * @param {boolean} valueOnly true for the node-browser badge (no suffix)
 * @returns {string | null} display label, '' to suppress the badge, or null to
 *   fall through to the upstream pricing path
 */
export const platformSettlementBadge = (name, isApiNode, valueOnly) => {
  if (isApiNode !== true) return null
  const millicredits = EDITOR_API_NODE_SETTLEMENT_MILLICREDITS[name]
  if (millicredits === undefined) return ''
  const usd = formatPlatformSettlementUsd(millicredits)
  if (usd === null) return ''
  return valueOnly ? usd : `${usd}/Run · platform settlement`
}

/**
 * The client-side twin of {@link platformSettlementBadge}, as a source string
 * the vite transform injects into the two upstream display modules. Generated
 * here (not hand-written in the override config) so the decision logic exists
 * in exactly one place.
 *
 * @param {{ localeAware?: boolean }} [options] `localeAware` (night round 5,
 * R5 copy fix 1) emits the canvas-badge variant
 * for the `useNodePricing.ts` seam: the suffix resolves through the editor's
 * EXISTING vue-i18n locale (an injected `import { i18n } from '@/i18n'` — the
 * app module the whole frontend already reads the active locale from), so the
 * badge follows the user's language switch reactively (the locale ref read
 * inside the render-path getter registers the same dependency
 * `pricingTick` does). zh locales render `/次 · 平台计价`; every other locale
 * keeps the English suffix (the adapter owns only this zh/EN pair — it never
 * invents copy for locales it does not carry). The plain variant (default)
 * stays import-free for the shared-utils seam, whose value-only surface
 * never renders the suffix anyway.
 */
export const platformBadgeHelperSource = (options = {}) => {
  const entries = Object.entries(EDITOR_API_NODE_SETTLEMENT_MILLICREDITS)
    .map(([name, millicredits]) => `${JSON.stringify(name)}:${millicredits}`)
    .join(',')
  const localeAware = options.localeAware === true
  return [
    '// DomonAI platform adapter (SPEC 0137) — build-time injected, source:',
    '// packages/api/scripts/editor-node-pricing-adapter.mjs (pinned to',
    '// CREDITS_PER_CLASS_TYPE by contract test). Replaces the upstream Comfy',
    '// Cloud credits badge with the platform settlement rate.',
    ...(localeAware ? [
      '// R5 copy fix 1 (2026-11-09): the settlement suffix follows the editor',
      '// locale through the existing i18n module — external adapter seam only,',
      '// no upstream locale file is added or modified.',
      "import { i18n } from '@/i18n'",
      'const __domonaiPlatformSettlementSuffix = () => {',
      '  const locale = i18n.global.locale.value',
      "  return typeof locale === 'string' && locale.startsWith('zh') ? '/次 · 平台计价' : '/Run · platform settlement'",
      '}',
    ] : []),
    `const __DOMONAI_PLATFORM_SETTLEMENT_MILLICREDITS = {${entries}}`,
    'const __domonaiPlatformSettlement = (name, isApiNode, valueOnly) => {',
    '  if (isApiNode !== true) return null',
    '  const mc = __DOMONAI_PLATFORM_SETTLEMENT_MILLICREDITS[name]',
    '  if (mc === undefined) return \'\'',
    "  const usd = (mc / 10000000).toFixed(4).replace(/0+$/, '').replace(/\\.$/, '')",
    localeAware
      ? "  return valueOnly ? '$' + usd : '$' + usd + __domonaiPlatformSettlementSuffix()"
      : "  return valueOnly ? '$' + usd : '$' + usd + '/Run · platform settlement'",
    '}',
  ].join('\n')
}

/**
 * The two upstream display choke points the adapter binds, with their
 * exact-string seams. Both files belong to the read-only frontend submodule;
 * a mismatch here means upstream drifted and the build must fail loudly
 * (never silently ship the misleading Comfy Cloud credits badge).
 *
 *   - `src/composables/node/useNodePricing.ts` — canvas + VueNodes node badges
 *     (badgeSystem nodeBadges, subgraph single-label path). At the seam the
 *     node is already known to be an api_node, so the helper gets `true`.
 *     `localeAware: true` (R5 copy fix 1) injects the i18n-reading helper —
 *     this is the ONLY surface that renders the settlement suffix, and it is
 *     an app module that already resolves `@/i18n`.
 *   - `packages/shared-frontend-utils/src/nodePricing.ts` — node browser /
 *     search badges (evaluateNodeDefPricing → NodePricingBadge). The node def
 *     is checked inline via `nodeDef.api_node === true`; the value-only format
 *     matches that surface's `formatPricingResult(..., { valueOnly: true })`.
 *     Its helper stays import-free (a shared-utils module cannot resolve the
 *     app's `@/i18n` alias, and its value-only badge has no suffix text).
 */
export const EDITOR_PRICING_SEAMS = Object.freeze([
  {
    suffix: 'src/composables/node/useNodePricing.ts',
    localeAware: true,
    find: '    const rule = getRuleForNode(node)\n    if (!rule) return \'\'',
    replacement:
      '    const __platformLabel = __domonaiPlatformSettlement(nodeData.name, true, false)\n' +
      '    if (__platformLabel !== null) return __platformLabel\n' +
      "    const rule = getRuleForNode(node)\n    if (!rule) return ''",
  },
  {
    suffix: 'packages/shared-frontend-utils/src/nodePricing.ts',
    find: "    const priceBadge = nodeDef.price_badge\n    if (!priceBadge?.expr) return ''",
    replacement:
      '    const priceBadge = nodeDef.price_badge\n' +
      '    const __platformLabel = __domonaiPlatformSettlement(nodeDef.name, nodeDef.api_node === true, true)\n' +
      '    if (__platformLabel !== null) return __platformLabel\n' +
      "    if (!priceBadge?.expr) return ''",
  },
])

/**
 * Pure module transform used by the editor build override
 * (comfy-vite-override.config.mts). Returns null for unrelated modules and for
 * already-adapted source; throws when a pinned seam no longer matches exactly
 * once (fail-closed — same convention as the dsh-toolchain patch layer).
 *
 * @param {string} code module source
 * @param {string} id vite module id (query string ignored)
 * @returns {{ code: string, map: null } | null}
 */
export const transformPricingModule = (code, id) => {
  const path = id.split('?')[0]
  const seam = EDITOR_PRICING_SEAMS.find((s) => path.endsWith(s.suffix))
  if (!seam) return null
  // Idempotency guard: never re-inject into already-adapted source.
  if (code.includes('__domonaiPlatformSettlement')) return null
  const occurrences = code.split(seam.find).length - 1
  if (occurrences !== 1) {
    throw new Error(
      `[comfy-platform-pricing-adapter] pinned pricing seam changed (${occurrences} matches) in ${seam.suffix} — update SPEC 0137 and EDITOR_PRICING_SEAMS against the upstream submodule`,
    )
  }
  return {
    code: `${platformBadgeHelperSource({ localeAware: seam.localeAware === true })}\n\n${code.replace(seam.find, seam.replacement)}`,
    map: null,
  }
}
