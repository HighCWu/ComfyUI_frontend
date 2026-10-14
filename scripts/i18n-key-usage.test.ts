import { describe, expect, it } from 'vitest'

import { createKeyUsageMatcher } from './i18n-key-usage'

describe('translation key usage matching', () => {
  it.for([
    { source: "t('g.run')", key: 'g.run', used: true },
    { source: '"g.run"', key: 'g.run', used: true },
    { source: '`g.run`', key: 'g.run', used: true },
    { source: '"\'g.run\'"', key: 'g.run', used: true },
    { source: '\'g.run"', key: 'g.run', used: true },
    { source: "t('other.run')", key: 'g.run', used: true },
    { source: "'other.run'", key: 'g.run', used: false },
    { source: "t('run')", key: 'g.run', used: false },
    { source: "t('g.runs')", key: 'g.run', used: false },
    { source: "'g.a+b'", key: 'g.a+b', used: true },
    { source: "'g.aaab'", key: 'g.a+b', used: false },
    { source: '"g.a\'b"', key: "g.a'b", used: true },
    { source: 't(`other.${value}.run`)', key: 'g.run', used: true }
  ])('$key matches $source: $used', ({ source, key, used }) => {
    expect(createKeyUsageMatcher([source])(key)).toBe(used)
  })

  it('reuses namespace results without hiding an exact key in another file', () => {
    const matches = createKeyUsageMatcher(["'g.run'", "t('other.cancel')"])
    expect(matches('unrelated.run')).toBe(false)
    expect(matches('g.run')).toBe(true)
    expect(matches('g.cancel')).toBe(true)
    expect(matches('another.cancel')).toBe(true)
  })
})
