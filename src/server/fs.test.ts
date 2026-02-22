import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { DATA_DIR } from './config'
import { normalizeRelativeStoragePath, safeResolveDataPath } from './fs'

describe('fs utilities', () => {
  it('normalizes and strips traversal prefixes', () => {
    expect(normalizeRelativeStoragePath('../../demo/../library/ch1')).toBe(
      'library/ch1',
    )
  })

  it('resolves paths safely under data directory', () => {
    const resolved = safeResolveDataPath('demo/series/chapter/page.jpg')

    expect(resolved.startsWith(DATA_DIR)).toBe(true)
    expect(path.basename(resolved)).toBe('page.jpg')
  })
})
