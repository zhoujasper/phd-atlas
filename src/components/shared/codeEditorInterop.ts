export function resolveCodeEditorExport<T>(moduleExport: T | { default: T }): T {
  if (moduleExport && typeof moduleExport === 'object' && 'default' in moduleExport) {
    return (moduleExport as { default: T }).default
  }
  return moduleExport as T
}
