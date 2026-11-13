type Location = { id: string; name: string }

/** Missing access details are unknown, not proof of no assignments or sessions. */
export function staffAccess(staff: { locations?: Location[] | null; activeSessions?: number | null }) {
  return {
    locations: Array.isArray(staff.locations) ? staff.locations : null,
    activeSessions: typeof staff.activeSessions === 'number' ? staff.activeSessions : null,
  }
}
