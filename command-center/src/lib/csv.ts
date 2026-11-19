/**
 * RFC 4180 CSV: quoted fields may hold commas, doubled quotes and newlines (Shopify's Note Attributes do).
 * A leading BOM is dropped. Pure; used by the Shopify and vFulfill export importers.
 */
export function parseCsv(text: string): string[][] {
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++ } else quoted = false
      } else field += c
    } else if (c === '"' && field === '') quoted = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++
      row.push(field); rows.push(row); row = []; field = ''
    } else field += c
  }
  if (quoted) throw new Error('CSV ends inside a quoted field')
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row) }
  return rows.filter((r) => !(r.length === 1 && r[0] === ''))
}

/** Rows as objects keyed by the header row. Throws when a row has a different number of fields than the header. */
export function csvRecords(text: string): Record<string, string>[] {
  const [header, ...rows] = parseCsv(text)
  if (!header) return []
  return rows.map((r, i) => {
    if (r.length !== header.length) throw new Error(`CSV row ${i + 2}: ${r.length} fields, header has ${header.length}`)
    return Object.fromEntries(header.map((h, j) => [h, r[j]]))
  })
}
