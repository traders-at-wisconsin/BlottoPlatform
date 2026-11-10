/** Public-facing label: name only, never email. */
export function displayNameOf(person: {
  displayName?: string | null
  uid?: string
}): string {
  const name = person.displayName?.trim()
  if (name) return name
  return 'Player'
}
