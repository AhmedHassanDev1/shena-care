type StaffRole = 'ADMIN' | 'HUB_OPERATOR' | 'SUPPLIER' | 'DRIVER' | 'CUSTOMER'

/** Workspace path prefix each role may open (mirrors RoleShell; the API stays the real boundary). */
const PREFIX: Record<string, string[]> = {
  ADMIN: ['/admin', '/hub', '/print'],
  HUB_OPERATOR: ['/hub', '/print'],
  SUPPLIER: ['/supplier'],
  DRIVER: ['/driver'],
}

export function workspacePrefixes(roles: readonly StaffRole[]): string[] {
  return [...new Set(roles.flatMap((role) => PREFIX[role] ?? []))]
}

/**
 * Where to send someone after sign-in. Only a same-origin, in-app path inside a workspace the account is
 * allowed to use is honoured; anything else (absolute URLs, `//host`, backslashes, other roles' areas,
 * the login page itself) falls back to the role home. Returns null when `next` is not usable.
 */
export function safeNextPath(next: string | null | undefined, roles: readonly StaffRole[]): string | null {
  if (!next || next.length > 512 || !next.startsWith('/') || next.startsWith('//')) return null
  if (next.includes(String.fromCharCode(92)) || [...next].some((ch) => ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f)) return null
  let url: URL
  try {
    url = new URL(next, 'http://redirect.invalid')
  } catch {
    return null
  }
  if (url.origin !== 'http://redirect.invalid') return null
  const path = url.pathname
  const allowed = workspacePrefixes(roles).some((prefix) => path === prefix || path.startsWith(`${prefix}/`))
  return allowed ? `${path}${url.search}` : null
}
