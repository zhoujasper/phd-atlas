export function professorAvatarTone(identity: string) {
  let hash = 0
  for (const char of identity) hash = ((hash * 31) + char.charCodeAt(0)) >>> 0
  return hash % 6
}

