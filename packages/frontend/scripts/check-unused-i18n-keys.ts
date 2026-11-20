#!/usr/bin/env tsx
import { execSync } from 'child_process'
import * as fs from 'fs'
import { globSync } from 'glob'
import type { LocaleData } from './i18n-types'
import { isNestedLocaleData } from './i18n-types'
import { createKeyUsageMatcher } from './i18n-key-usage'

// Configuration
const SOURCE_PATTERNS = ['src/**/*.{js,ts,vue}', '!src/locales/**/*']
const IGNORE_PATTERNS = [
  // Keys that might be dynamically constructed
  /^commands\./, // Command definitions are loaded dynamically
  /^settings\..*\.options\./, // Setting options are rendered dynamically
  /^nodeDefs\./, // Node definitions are loaded from backend
  /^templateWorkflows\./, // Template workflows are loaded dynamically
  /^dataTypes\./, // Data types might be referenced dynamically
  /^contextMenu\./, // Context menu items might be dynamic
  /^color\./, // Color names might be used dynamically
  /^onboardingCoachmarks\.[^.]+\.[^.]+\./, // Step keys derived as onboardingCoachmarks.<tour>.<step>.*
  // Auto-generated categories from collect-i18n-general.ts
  /^menuLabels\./, // Menu labels generated from command labels
  /^settingsCategories\./, // Settings categories generated from setting definitions
  /^serverConfigItems\./, // Server config items generated from SERVER_CONFIG_ITEMS
  /^serverConfigCategories\./, // Server config categories generated from config categories
  /^nodeCategories\./, // Node categories generated from node definitions
  // Setting option values that are dynamically generated
  /\.options\./ // All setting options are rendered dynamically
]

// Get list of staged locale files
function getStagedLocaleFiles(): string[] {
  try {
    const output = execSync('git diff --cached --name-only --diff-filter=AM', {
      encoding: 'utf-8'
    })
    return output
      .split('\n')
      .filter((file) => /^src\/locales\/[^./][^/]*\/[^/]+\.json$/.test(file))
  } catch {
    return []
  }
}

// Extract all keys from a nested object
function extractKeys(obj: LocaleData, prefix = ''): string[] {
  const keys: string[] = []

  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key

    if (isNestedLocaleData(value)) {
      keys.push(...extractKeys(value, fullKey))
    } else {
      keys.push(fullKey)
    }
  }

  return keys
}

// Get new keys added in staged files
function getNewKeysFromStagedFiles(stagedFiles: string[]): Set<string> {
  const newKeys = new Set<string>()

  for (const file of stagedFiles) {
    try {
      const stagedContent = execSync(`git show :${file}`, {
        encoding: 'utf-8',
        maxBuffer: 16 * 1024 * 1024
      })
      const stagedData: LocaleData = JSON.parse(stagedContent)
      const stagedKeys = new Set(extractKeys(stagedData))

      let headKeys = new Set<string>()
      try {
        const headContent = execSync(`git show HEAD:${file}`, {
          encoding: 'utf-8',
          maxBuffer: 16 * 1024 * 1024
        })
        const headData: LocaleData = JSON.parse(headContent)
        headKeys = new Set(extractKeys(headData))
      } catch {
        headKeys = new Set<string>()
      }

      stagedKeys.forEach((key) => {
        if (!headKeys.has(key)) {
          newKeys.add(key)
        }
      })
    } catch (error) {
      console.error(`Error processing ${file}:`, error)
    }
  }

  return newKeys
}

// Check if a key should be ignored
function shouldIgnoreKey(key: string): boolean {
  return IGNORE_PATTERNS.some((pattern) => pattern.test(key))
}

// Search for key usage in source files
// Main function
async function checkNewUnusedKeys() {
  const stagedLocaleFiles = getStagedLocaleFiles()

  if (stagedLocaleFiles.length === 0) {
    process.exit(0)
  }

  const newKeys = getNewKeysFromStagedFiles(stagedLocaleFiles)

  if (newKeys.size === 0) {
    process.exit(0)
  }

  const sourceContents = globSync(SOURCE_PATTERNS).map((file) =>
    fs.readFileSync(file, 'utf-8')
  )
  const isKeyUsed = createKeyUsageMatcher(sourceContents)

  const unusedNewKeys: string[] = []

  newKeys.forEach((key) => {
    if (!shouldIgnoreKey(key) && !isKeyUsed(key)) {
      unusedNewKeys.push(key)
    }
  })

  if (unusedNewKeys.length > 0) {
    console.warn('\n⚠️  Warning: Found unused NEW i18n keys:\n')

    for (const key of unusedNewKeys.sort()) {
      console.warn(`  - ${key}`)
    }

    console.warn(`\n✨ Total unused new keys: ${unusedNewKeys.length}`)
    console.warn(
      '\nThese keys were added but are not used anywhere in the codebase.'
    )
    console.warn('Consider using them or removing them in a future update.')

    process.exit(0)
  }
}

// Run the check
checkNewUnusedKeys().catch((err) => {
  console.error('Error checking unused keys:', err)
  process.exit(1)
})
