// Character-by-character CSV parser. Handles quoted fields containing commas,
// escaped double-quotes, and CRLF line endings — a naive split(',') misaligns
// every column after the first quoted comma, which in these files silently
// shifts amounts into the wrong field.
//
// Header cells are normalised to snake_case keys:
//   "Shopify Order name" -> shopify_order_name
//   "Closed On"          -> closed_on
//   "RTO Marked On"      -> rto_marked_on

export function parseCSV(text) {
  const records = []
  let headers = null
  let row = []
  let field = ''
  let inQuote = false

  const flush = () => { row.push(field.trim()); field = '' }

  const commitRow = () => {
    if (row.length === 0 || row.every((f) => f === '')) { row = []; return }
    if (!headers) {
      headers = row.map((h) => h.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, ''))
    } else {
      const obj = {}
      headers.forEach((h, i) => { obj[h] = row[i] ?? '' })
      records.push(obj)
    }
    row = []
  }

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuote) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; continue }
        inQuote = false
      } else if (ch !== '\r') {
        field += ch
      }
    } else {
      if      (ch === '"')  inQuote = true
      else if (ch === ',')  flush()
      else if (ch === '\n') { flush(); commitRow() }
      else if (ch === '\r') { /* skip */ }
      else                  field += ch
    }
  }
  if (field !== '' || row.length > 0) { flush(); commitRow() }

  return records
}
