export const PORTABLE_STORAGE_DIRNAME: string
export const PORTABLE_USER_DATA_DIRNAME: string
export const PORTABLE_README_NAME: string

export interface PortablePathOptions {
  packaged?: boolean
  platform?: string
  execPath?: string
  projectRoot?: string
}

export interface PortableStorageRootOptions extends PortablePathOptions {
  envStorageRoot?: string
}

export function resolvePortableAppDirectory(options?: PortablePathOptions): string

export function resolvePortableStorageRoot(options?: PortableStorageRootOptions): string

export function resolvePortableUserDataRoot(options?: PortablePathOptions): string

export function migrateLegacyPortableDirectories(appDirectory: string): string

export function portableReadmeText(): string

export function writePortableReadme(appDirectory: string): string

export function installPortableLayout(appDirectory: string): string

export function assertDirectoryWritable(directory: string): string
