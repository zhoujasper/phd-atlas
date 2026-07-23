export function avatarInitial(name?: string, email?: string) {
  return name?.trim().charAt(0).toUpperCase()
    || email?.trim().charAt(0).toUpperCase()
    || '?'
}
