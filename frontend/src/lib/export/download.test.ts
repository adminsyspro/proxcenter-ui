import { describe, expect, it } from 'vitest'

import { csvCell, dateStamp, filenameSlug, timestampCell, toCsv } from './download'

describe('csvCell', () => {
  it('doubles an embedded quote instead of ending the cell', () => {
    expect(csvCell('name "web01"')).toBe('"name ""web01"""')
  })

  it('keeps a comma and a newline inside one cell', () => {
    expect(csvCell('a,b')).toBe('"a,b"')
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"')
  })

  it('writes an empty cell for null and undefined rather than the word', () => {
    expect(csvCell(null)).toBe('""')
    expect(csvCell(undefined)).toBe('""')
  })

  it('keeps a zero, which is a value and not an absence', () => {
    expect(csvCell(0)).toBe('"0"')
  })
})

describe('toCsv', () => {
  it('writes the header row then the data rows', () => {
    expect(toCsv(['a', 'b'], [[1, 2], [3, 4]])).toBe('"a","b"\r\n"1","2"\r\n"3","4"')
  })

  it('emits the header alone when there is no data', () => {
    expect(toCsv(['a'], [])).toBe('"a"')
  })

  it('survives a value holding the separator and the row terminator', () => {
    const csv = toCsv(['v'], [['x","y\r\nz']])

    expect(csv).toBe('"v"\r\n"x"",""y\r\nz"')
  })
})

describe('timestampCell', () => {
  it('writes local time a spreadsheet parses as a date', () => {
    expect(timestampCell(new Date(2026, 8, 11, 8, 5, 3))).toBe('2026-09-11 08:05:03')
  })

  it('writes nothing for a timestamp it cannot read', () => {
    expect(timestampCell('not a date')).toBe('')
    expect(timestampCell('')).toBe('')
  })
})

describe('dateStamp', () => {
  it('pads the month and the day', () => {
    expect(dateStamp(new Date(2026, 0, 5))).toBe('2026-01-05')
  })
})

describe('filenameSlug', () => {
  it('replaces what a filesystem refuses', () => {
    expect(filenameSlug('Site A / prod')).toBe('Site-A-prod')
  })

  it('falls back rather than producing an empty name', () => {
    expect(filenameSlug('///')).toBe('export')
  })

  it('caps the length so the filename stays usable', () => {
    expect(filenameSlug('a'.repeat(200))).toHaveLength(60)
  })
})
