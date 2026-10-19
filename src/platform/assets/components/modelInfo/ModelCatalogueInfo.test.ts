import { render, screen } from '@testing-library/vue'
import { describe, expect, it } from 'vitest'
import { createI18n } from 'vue-i18n'

import en from '@/locales/en/main.json'
import type { AssetItem } from '@/platform/assets/schemas/assetSchema'

import ModelCatalogueInfo from './ModelCatalogueInfo.vue'

const asset: AssetItem = {
  id: 'catalogue-test',
  name: 'nested/model.pth',
  tags: ['models', 'upscale_models'],
  created_at: '2026-10-20T00:00:00Z',
  updated_at: '2026-10-20T00:00:00Z'
}

function renderInfo(metadata: AssetItem['metadata']) {
  return render(ModelCatalogueInfo, {
    props: { asset: { ...asset, metadata } },
    global: {
      plugins: [createI18n({ legacy: false, locale: 'en', messages: { en } })]
    }
  })
}

describe('model catalogue information', () => {
  it('shows explicit missing values and no readiness claim for a listed model', () => {
    renderInfo({
      laimon_model: {
        source_url: null,
        license: null,
        publisher_name: null,
        r2_cache_status: 'not_registered'
      }
    })
    expect(screen.getAllByText('Not provided')).toHaveLength(3)
    expect(
      screen.getByText('Listed — no R2 cache registered')
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        /Regional caches and weight integrity have not been checked/
      )
    ).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
  it('shows the source, license and publisher without confusing a cache record with readiness', () => {
    renderInfo({
      laimon_model: {
        source_url: 'https://huggingface.co/example/repo',
        license: 'Apache-2.0',
        publisher_name: 'Curated publisher',
        r2_cache_status: 'registered'
      }
    })
    expect(
      screen.getByRole('link', { name: 'View on Hugging Face' })
    ).toHaveAttribute('href', 'https://huggingface.co/example/repo')
    expect(screen.getByText('Apache-2.0')).toBeInTheDocument()
    expect(screen.getByText('Curated publisher')).toBeInTheDocument()
    expect(
      screen.getByText('R2 cache registered — not checked live')
    ).toBeInTheDocument()
  })
  it('does not infer cache readiness from an old server or a download URL', () => {
    renderInfo({
      download_url: 'https://example.com/model',
      repo_url: 'https://civitai.com/models/12'
    })
    expect(screen.getByText('Cache status not provided')).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'View on Civitai' })
    ).toBeInTheDocument()
  })
  it.for(['javascript:alert(1)', 'https://user:password@example.com/model'])(
    'does not render an unsafe source link: %s',
    (repo_url) => {
      renderInfo({ repo_url })
      expect(screen.queryByRole('link')).not.toBeInTheDocument()
    }
  )
})
