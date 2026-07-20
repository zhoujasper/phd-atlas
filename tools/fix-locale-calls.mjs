import fs from 'node:fs'

const files = [
  'src/components/shared/AiKeyManager.tsx',
  'src/components/screens/AdminScreen.tsx',
  'src/components/screens/Inspector.tsx',
  'src/components/screens/DossierView.tsx',
  'src/components/screens/ProfileScreen.tsx',
  'src/components/screens/ShareViewer.tsx',
  'src/components/screens/TeamScreen.tsx',
  'src/components/shared/NotificationCenter.tsx',
  'src/components/shared/ShareDialog.tsx',
]

const patterns = [
  [/lang === 'zh' \? 'zh-CN' : 'en-US'/g, 'localeForLanguage(lang)'],
  [/lang === 'zh' \? 'zh-CN' : 'en-GB'/g, 'localeForLanguage(lang)'],
  [/lang === 'zh' \? 'zh-CN' : 'en'/g, 'localeForLanguage(lang)'],
  [/lang === "zh" \? "zh-CN" : "en-US"/g, 'localeForLanguage(lang)'],
  [/lang === "zh" \? "zh-CN" : "en-GB"/g, 'localeForLanguage(lang)'],
  [/lang === "zh" \? "zh-CN" : "en"/g, 'localeForLanguage(lang)'],
]

for (const file of files) {
  let source = fs.readFileSync(file, 'utf8')
  let next = source
  for (const [pattern, value] of patterns) next = next.replace(pattern, value)
  if (next === source) {
    console.log('skip', file)
    continue
  }
  if (!next.includes('localeForLanguage')) {
    if (/import type \{[^}]+\} from '\.\.\/\.\.\/i18n'/.test(next)) {
      next = next.replace(
        /import type \{[^}]+\} from '\.\.\/\.\.\/i18n'/,
        (match) => `${match}\nimport { localeForLanguage } from '../../i18n'`,
      )
    } else if (/import \{[^}]+\} from '\.\.\/\.\.\/i18n'/.test(next)) {
      next = next.replace(/import \{([^}]+)\} from '\.\.\/\.\.\/i18n'/, (_, group) => {
        if (group.includes('localeForLanguage')) return `import {${group}} from '../../i18n'`
        return `import { ${group.trim().replace(/,$/, '')}, localeForLanguage } from '../../i18n'`
      })
    } else {
      next = `import { localeForLanguage } from '../../i18n'\n${next}`
    }
  }
  fs.writeFileSync(file, next)
  console.log('ok', file)
}
