import { beforeEach, describe, expect, it, vi } from 'vitest'

import { buildFeedbackTypeformUrl, buildSupportUrl } from './config'

const distribution = vi.hoisted(() => ({ isCloud: false, isNightly: false }))

vi.mock(import('@/platform/distribution/types'), () => ({
  get isCloud() {
    return distribution.isCloud
  },
  get isNightly() {
    return distribution.isNightly
  }
}))

it('keeps prepaid support and help-center feedback on the first-party site without user identifiers', () => {
  vi.stubEnv('VITE_RUN_BILLING_MODE', 'prepaid')

  expect(
    buildSupportUrl({
      userEmail: 'private@example.test',
      userId: 'private-user'
    })
  ).toBe('/support')
  expect(buildFeedbackTypeformUrl('help-center')).toBe('/support')
})

it('preserves upstream support prefill outside prepaid mode', () => {
  vi.stubEnv('VITE_RUN_BILLING_MODE', '')

  const url = new URL(
    buildSupportUrl({
      userEmail: 'upstream@example.test',
      userId: 'upstream-user'
    })
  )

  expect(url.origin).toBe('https://support.comfy.org')
  expect(url.pathname).toBe('/hc/en-us/requests/new')
  expect(url.searchParams.get('tf_anonymous_requester_email')).toBe(
    'upstream@example.test'
  )
  expect(url.searchParams.get('tf_40029135130388')).toBe(
    'upstream@example.test'
  )
  expect(url.searchParams.get('tf_42515251051412')).toBe('upstream-user')
})

describe('buildFeedbackTypeformUrl', () => {
  beforeEach(() => {
    distribution.isCloud = false
    distribution.isNightly = false
  })

  async function build(source: 'topbar' | 'action-bar' | 'help-center') {
    vi.resetModules()
    const { buildFeedbackTypeformUrl } = await import('./config')
    return buildFeedbackTypeformUrl(source)
  }

  it('tags Cloud builds with distribution=ccloud', async () => {
    distribution.isCloud = true
    expect(await build('topbar')).toBe(
      'https://form.typeform.com/to/q7azbWPi#distribution=ccloud&source=topbar'
    )
  })

  it('tags Nightly builds with distribution=oss-nightly', async () => {
    distribution.isNightly = true
    expect(await build('action-bar')).toBe(
      'https://form.typeform.com/to/q7azbWPi#distribution=oss-nightly&source=action-bar'
    )
  })

  it('tags OSS builds with distribution=oss', async () => {
    expect(await build('help-center')).toBe(
      'https://form.typeform.com/to/q7azbWPi#distribution=oss&source=help-center'
    )
  })

  it('uses a URL fragment so distribution and source are not sent to the server', async () => {
    distribution.isCloud = true
    const url = new URL(await build('topbar'))
    expect(url.search).toBe('')
    expect(url.hash).toBe('#distribution=ccloud&source=topbar')
  })
})

describe('buildFeedbackHiddenFields', () => {
  beforeEach(() => {
    distribution.isCloud = false
    distribution.isNightly = false
  })

  async function build(
    source: 'topbar' | 'action-bar' | 'help-center',
    extraTags?: Record<string, string>
  ) {
    vi.resetModules()
    const { buildFeedbackHiddenFields } = await import('./config')
    return buildFeedbackHiddenFields(source, extraTags)
  }

  it('reflects the build distribution', async () => {
    distribution.isNightly = true
    expect(await build('action-bar')).toBe(
      'distribution=oss-nightly,source=action-bar'
    )
  })

  it('appends extra tags after the base segmentation tags', async () => {
    distribution.isCloud = true
    expect(await build('topbar', { email: 'user@example.com' })).toBe(
      'distribution=ccloud,source=topbar,email=user@example.com'
    )
  })

  it('escapes commas in values so they survive the data-tf-hidden parser', async () => {
    distribution.isCloud = true
    expect(await build('topbar', { email: 'a,b@example.com' })).toBe(
      'distribution=ccloud,source=topbar,email=a\\,b@example.com'
    )
  })
})
