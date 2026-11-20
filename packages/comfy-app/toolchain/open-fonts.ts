import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'

export const openFontSources = [
  'src/platform/cloud/onboarding/assets/css/fonts.css',
  'src/assets/css/style.css',
] as const

export function transformOpenFonts(code: string, id: string): string | null {
  const path = id.split('?')[0]!.replaceAll('\\', '/')
  if (path.endsWith('/' + openFontSources[0])) {
    if ((code.match(/@font-face\s*\{/g) ?? []).length !== 3
      || !['Light', 'Medium', 'Semibold'].every(weight => code.includes(`PPFormula-${weight}.woff2`)))
      throw Error('Onboarding font source changed; review open-font replacement')
    return '/* DomonAI uses the existing Inter family; no proprietary font URLs. */\n'
  }
  if (path.endsWith('/' + openFontSources[1])) {
    if (!code.includes("@import '@comfyorg/design-system/css/style.css';"))
      throw Error('Design-system stylesheet import changed; review font replacement')
    return code + "\n@theme { --font-formula: 'Inter', sans-serif; }\n"
  }
  return null
}

export async function auditOpenFonts(directory: string) {
  let fontFiles = 0, runtimeFiles = 0
  const visit = async (parent: string) => {
    for (const entry of await readdir(resolve(directory, parent), { withFileTypes: true })) {
      const path = parent ? parent + '/' + entry.name : entry.name
      if (entry.isDirectory()) { await visit(path); continue }
      if (/\.(?:woff2?|otf|ttf)$/i.test(path)) {
        fontFiles++
        if (/ppformula|abcrom/i.test(path)) throw Error('Proprietary font binary in output: ' + path)
      }
      if (/\.(?:css|js|html)$/i.test(path)) {
        runtimeFiles++
        if (/PPFormula[-_]|PP Formula|ABCROM/i.test(await readFile(resolve(directory, path), 'utf8')))
          throw Error('Proprietary font runtime reference in output: ' + path)
      }
    }
  }
  await visit('')
  await readFile(resolve(directory, 'fonts/inter-latin-normal.woff2'))
  await readFile(resolve(directory, 'assets/licenses/Inter-LICENSE.txt'))
  return { profile: 'inter-without-proprietary-fonts/v1', fontFiles, runtimeFiles, knownProprietaryFonts: 0 }
}
