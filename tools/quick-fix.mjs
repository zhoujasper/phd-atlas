#!/usr/bin/env node

/**
 * PhD Atlas 快速诊断和优化工具
 *
 * 使用方法:
 *   node tools/quick-fix.mjs               # 运行诊断
 *   node tools/quick-fix.mjs --apply       # 应用优化配置
 *   node tools/quick-fix.mjs --check-db    # 检查数据库健康
 */

import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const projectRoot = resolve(__dirname, '..')

const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
}

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`)
}

function section(title) {
  console.log('')
  log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, 'cyan')
  log(`  ${title}`, 'cyan')
  log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, 'cyan')
}

function check(label, passed, details = '') {
  const icon = passed ? '✓' : '✗'
  const color = passed ? 'green' : 'red'
  log(`${icon} ${label}`, color)
  if (details) {
    console.log(`  ${details}`)
  }
}

async function diagnose() {
  section('系统诊断')

  // 检查文件大小
  const filesToCheck = [
    { path: 'server/index.js', warn: 10000, critical: 20000 },
    { path: 'server/storage.js', warn: 10000, critical: 20000 },
    { path: 'src/App.tsx', warn: 5000, critical: 10000 },
    { path: 'src/components/screens/DossierView.tsx', warn: 5000, critical: 10000 },
  ]

  console.log('\n📁 源文件大小检查:\n')
  for (const { path, warn, critical } of filesToCheck) {
    const fullPath = resolve(projectRoot, path)
    if (existsSync(fullPath)) {
      const content = readFileSync(fullPath, 'utf-8')
      const lines = content.split('\n').length
      const status = lines > critical ? 'critical' : lines > warn ? 'warning' : 'ok'

      if (status === 'critical') {
        check(`${path}: ${lines.toLocaleString()} 行`, false,
          `⚠️  需要拆分! 超过${critical.toLocaleString()}行临界值`)
      } else if (status === 'warning') {
        check(`${path}: ${lines.toLocaleString()} 行`, true,
          `⚠️  建议拆分 (超过${warn.toLocaleString()}行)`)
      } else {
        check(`${path}: ${lines.toLocaleString()} 行`, true)
      }
    }
  }

  // 检查环境配置
  console.log('\n⚙️  环境配置检查:\n')

  const envPath = resolve(projectRoot, '.env')
  const envPerformancePath = resolve(projectRoot, '.env.performance')
  const hasEnv = existsSync(envPath)
  const hasPerformanceTemplate = existsSync(envPerformancePath)

  check('性能配置模板存在', hasPerformanceTemplate,
    hasPerformanceTemplate ? '可使用 --apply 应用优化配置' : '')

  if (hasEnv) {
    const envContent = readFileSync(envPath, 'utf-8')
    const checkConfig = (key, recommended) => {
      const match = envContent.match(new RegExp(`^${key}=(.+)$`, 'm'))
      const current = match ? match[1] : undefined
      return { current, recommended, set: !!match }
    }

    const configs = [
      checkConfig('MUTATION_MAX_ACTIVE', '16'),
      checkConfig('WORKSPACE_STREAM_PREP_MAX_ACTIVE', '4'),
      checkConfig('HEAVY_WORK_MAX_ACTIVE', '4'),
      checkConfig('STANDARD_WORK_MAX_ACTIVE', '64'),
    ]

    const needsUpdate = configs.some(c => !c.set || parseInt(c.current) < parseInt(c.recommended))

    check('.env 文件存在', true)
    if (needsUpdate) {
      log('  建议更新配置以提升性能 (使用 --apply)', 'yellow')
    } else {
      log('  配置已优化', 'green')
    }
  } else {
    check('.env 文件存在', false, '使用默认配置 (可能过于保守)')
  }

  // 检查数据库
  console.log('\n💾 数据库检查:\n')

  const dbPath = resolve(projectRoot, 'storage/phd-atlas.sqlite')
  if (existsSync(dbPath)) {
    const stats = statSync(dbPath)
    const sizeMB = (stats.size / 1024 / 1024).toFixed(2)
    check(`数据库大小: ${sizeMB} MB`, true,
      stats.size > 500_000_000 ? '⚠️  数据库较大，建议定期备份和清理' : '')
  } else {
    check('数据库文件', false, '未找到 storage/phd-atlas.sqlite')
  }

  // 检查Git状态
  console.log('\n🔍 Git状态检查:\n')

  const gitStatus = await new Promise((resolve) => {
    import('node:child_process').then(({ exec }) => {
      exec('git status --porcelain', { cwd: projectRoot }, (error, stdout) => {
        resolve(error ? null : stdout)
      })
    })
  })

  if (gitStatus !== null) {
    const modifiedFiles = gitStatus.split('\n').filter(Boolean)
    check(`未提交的更改: ${modifiedFiles.length} 个文件`,
      modifiedFiles.length === 0,
      modifiedFiles.length > 0 ? '建议提交或暂存更改' : '')
  }

  // 检查node_modules
  console.log('\n📦 依赖检查:\n')

  const nodeModulesPath = resolve(projectRoot, 'node_modules')
  const packageLockPath = resolve(projectRoot, 'package-lock.json')

  if (existsSync(nodeModulesPath) && existsSync(packageLockPath)) {
    const lockMtime = statSync(packageLockPath).mtime
    const nodeModulesMtime = statSync(nodeModulesPath).mtime

    const isOutdated = lockMtime > nodeModulesMtime
    check('依赖已同步', !isOutdated,
      isOutdated ? '运行 npm ci 更新依赖' : '')
  } else {
    check('依赖已安装', false, '运行 npm ci 安装依赖')
  }

  // 总结
  section('诊断总结')

  console.log('\n💡 建议的下一步操作:\n')

  const actions = []

  if (!hasEnv || (hasEnv && readFileSync(envPath, 'utf-8').match(/^MUTATION_MAX_ACTIVE=4/m))) {
    actions.push('1️⃣  应用性能优化配置: node tools/quick-fix.mjs --apply')
  }

  if (filesToCheck.some(f => {
    const fullPath = resolve(projectRoot, f.path)
    return existsSync(fullPath) && readFileSync(fullPath, 'utf-8').split('\n').length > f.critical
  })) {
    actions.push('2️⃣  Review large files against docs/ARCHITECTURE.md before splitting')
  }

  actions.push('3️⃣  运行测试确保系统稳定: npm test')
  actions.push('4️⃣  启动开发服务器: npm run dev')

  actions.forEach(action => console.log(action))

  console.log('')
}

async function applyOptimizations() {
  section('应用性能优化配置')

  const envPath = resolve(projectRoot, '.env')
  const envPerformancePath = resolve(projectRoot, '.env.performance')
  const envExamplePath = resolve(projectRoot, '.env.example')

  if (!existsSync(envPerformancePath)) {
    log('错误: .env.performance 文件不存在', 'red')
    process.exit(1)
  }

  // 读取性能配置
  const performanceConfig = readFileSync(envPerformancePath, 'utf-8')
  const performanceSettings = {}

  performanceConfig.split('\n').forEach(line => {
    const match = line.match(/^([A-Z_]+)=(.+)$/)
    if (match) {
      performanceSettings[match[1]] = match[2]
    }
  })

  let existingConfig = ''
  if (existsSync(envPath)) {
    console.log('\n现有 .env 文件将被更新\n')
    existingConfig = readFileSync(envPath, 'utf-8')
  } else if (existsSync(envExamplePath)) {
    console.log('\n从 .env.example 创建 .env 文件\n')
    existingConfig = readFileSync(envExamplePath, 'utf-8')
  } else {
    console.log('\n创建新的 .env 文件\n')
  }

  // 更新配置
  let updatedConfig = existingConfig
  let changedCount = 0

  for (const [key, value] of Object.entries(performanceSettings)) {
    const regex = new RegExp(`^#?\\s*${key}=.*$`, 'm')
    if (updatedConfig.match(regex)) {
      const oldValue = updatedConfig.match(regex)?.[0]
      updatedConfig = updatedConfig.replace(regex, `${key}=${value}`)
      if (oldValue !== `${key}=${value}`) {
        log(`✓ 更新 ${key}=${value}`, 'green')
        changedCount++
      }
    } else {
      updatedConfig += `\n${key}=${value}`
      log(`✓ 添加 ${key}=${value}`, 'green')
      changedCount++
    }
  }

  // 写入文件
  writeFileSync(envPath, updatedConfig)

  console.log('')
  log(`✅ 成功应用 ${changedCount} 项性能优化`, 'green')
  console.log('\n重启服务器以使配置生效: npm run dev\n')
}

async function checkDatabase() {
  section('数据库健康检查')

  const dbPath = resolve(projectRoot, 'storage/phd-atlas.sqlite')

  if (!existsSync(dbPath)) {
    log('数据库文件不存在', 'red')
    return
  }

  try {
    const Database = (await import('better-sqlite3')).default
    const db = new Database(dbPath, { readonly: true })

    console.log('\n📊 数据库统计:\n')

    // 获取表大小
    const tables = db.prepare(`
      SELECT name,
             (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=m.name) as count
      FROM sqlite_master m
      WHERE type='table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `).all()

    for (const table of tables) {
      try {
        const count = db.prepare(`SELECT COUNT(*) as count FROM ${table.name}`).get()
        console.log(`  ${table.name}: ${count.count.toLocaleString()} 行`)
      } catch (e) {
        console.log(`  ${table.name}: 无法读取`)
      }
    }

    // 检查数据库完整性
    console.log('\n🔍 完整性检查:\n')
    const integrity = db.prepare('PRAGMA integrity_check').get()
    check('数据库完整性', integrity.integrity_check === 'ok',
      integrity.integrity_check !== 'ok' ? `问题: ${integrity.integrity_check}` : '')

    db.close()
  } catch (error) {
    log(`数据库检查失败: ${error.message}`, 'red')
  }
}

// 主函数
async function main() {
  const args = process.argv.slice(2)

  log('PhD Atlas 快速诊断和优化工具', 'blue')

  if (args.includes('--apply')) {
    await applyOptimizations()
  } else if (args.includes('--check-db')) {
    await checkDatabase()
  } else if (args.includes('--help') || args.includes('-h')) {
    console.log(`
使用方法:
  node tools/quick-fix.mjs               运行完整诊断
  node tools/quick-fix.mjs --apply       应用性能优化配置
  node tools/quick-fix.mjs --check-db    检查数据库健康
  node tools/quick-fix.mjs --help        显示此帮助信息
    `)
  } else {
    await diagnose()
  }
}

main().catch(error => {
  log(`\n错误: ${error.message}`, 'red')
  process.exit(1)
})
