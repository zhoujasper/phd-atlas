const ORGANISATION_NAME_SIGNAL = /\b(?:advice|advisory|associated faculty|board|central office|center|centre|cluster|committee|communication|computer|contacts?|curriculum|department|directory|diversity|facilities|faculty|frequently asked questions?|human resources?|in memoriam|institute|institution|interfaculty|key contacts?|lab(?:oratory)?|leadership|management|media|members?|office|people|phd students?|principal investigators?|program(?:me)?|questions?|research group|rooms?|school|staff|steering|team|university|vitae)\b/i

/**
 * Conservative identity gate for retained supervisors. It rejects labels that
 * name organisations, directories or groups while remaining Unicode-safe for
 * real personal names. Official-page matching still performs the authoritative
 * identity check after this inexpensive shape filter.
 */
export function isLikelyAdvisorPersonName(value) {
  const name = String(value || '').replace(/\s+/g, ' ').trim()
  if (!name || name.length > 180 || ORGANISATION_NAME_SIGNAL.test(name)) return false
  const tokens = name.split(/\s+/).filter(Boolean)
  if (!tokens.length || tokens.length > 8) return false
  if (tokens.length === 1) {
    return /^[\p{L}]{2,}$/u.test(tokens[0])
      && [...tokens[0]].some((character) => character.codePointAt(0) > 127)
  }
  return tokens.every((token) => (
    /^(?:[\p{L}][\p{L}'’.-]+|[\p{L}]\.)$/u.test(token)
  ))
}
