import { existsSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

export const PORTABLE_STORAGE_DIRNAME = 'User Data'
export const PORTABLE_USER_DATA_DIRNAME = 'Cache'
export const PORTABLE_README_NAME = 'Read Me.txt'
const LEGACY_STORAGE_DIRNAME = 'storage'
const LEGACY_USER_DATA_DIRNAME = 'data'

export function resolvePortableAppDirectory({
  packaged = false,
  platform = process.platform,
  execPath = process.execPath,
  projectRoot = '',
} = {}) {
  if (!packaged) {
    return resolve(projectRoot || '.')
  }
  const binary = String(execPath || '')
  if (platform === 'darwin') {
    return resolve(dirname(binary), '..', '..', '..')
  }
  return resolve(dirname(binary))
}

export function resolvePortableStorageRoot({
  packaged = false,
  platform = process.platform,
  execPath = process.execPath,
  projectRoot = '',
  envStorageRoot = '',
} = {}) {
  const override = String(envStorageRoot ?? '').trim()
  if (override) return resolve(override)
  const appDirectory = resolvePortableAppDirectory({
    packaged,
    platform,
    execPath,
    projectRoot,
  })
  if (!packaged) return join(appDirectory, LEGACY_STORAGE_DIRNAME)
  return join(appDirectory, PORTABLE_STORAGE_DIRNAME)
}

export function resolvePortableUserDataRoot(options = {}) {
  const appDirectory = resolvePortableAppDirectory(options)
  if (!options.packaged) return join(appDirectory, LEGACY_USER_DATA_DIRNAME)
  return join(appDirectory, PORTABLE_USER_DATA_DIRNAME)
}

export function migrateLegacyPortableDirectories(appDirectory) {
  const root = resolve(appDirectory)
  renameIfMissing(join(root, LEGACY_STORAGE_DIRNAME), join(root, PORTABLE_STORAGE_DIRNAME))
  renameIfMissing(join(root, LEGACY_USER_DATA_DIRNAME), join(root, PORTABLE_USER_DATA_DIRNAME))
  return root
}

export function portableReadmeText() {
  return [
    'PhD Atlas portable folder',
    '========================',
    '',
    'Keep these folders next to the application:',
    '',
    '  User Data/   Your applications, uploaded files, and backups.',
    '               Copy this folder with the app when you move it.',
    '  Cache/       Application cache. Safe to delete while the app is closed.',
    '  Read Me.txt  This file.',
    '',
    'Do not move User Data into Documents, Library, AppData, or another system folder.',
    '',
    '便携目录',
    '========',
    '',
    '请把下面的文件夹留在应用程序旁边：',
    '',
    '  User Data/   申请项目、上传文件和备份。搬家时请和应用程序一起带走。',
    '  Cache/       应用缓存，关闭应用后可以删除。',
    '  Read Me.txt  本说明。',
    '',
    '不要把 User Data 放到文稿、资料库、AppData 或其他系统目录。',
    '',
  ].join('\n')
}

export function writePortableReadme(appDirectory) {
  const root = resolve(appDirectory)
  mkdirSync(root, { recursive: true })
  writeFileSync(join(root, PORTABLE_README_NAME), portableReadmeText())
  return join(root, PORTABLE_README_NAME)
}

export function installPortableLayout(appDirectory) {
  const root = migrateLegacyPortableDirectories(appDirectory)
  writePortableReadme(root)
  return root
}

export function assertDirectoryWritable(directory) {
  const root = resolve(directory)
  mkdirSync(root, { recursive: true })
  const probe = join(root, '.phd-atlas-write-probe')
  writeFileSync(probe, 'ok')
  unlinkSync(probe)
  return root
}

function renameIfMissing(fromPath, toPath) {
  if (!existsSync(fromPath) || existsSync(toPath)) return
  renameSync(fromPath, toPath)
}
