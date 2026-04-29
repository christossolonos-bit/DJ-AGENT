export type SequenceSetRecord = {
  id: string
  name: string
  createdAt: string
  bpm: number
  pattern: boolean[][]
}

const STORAGE_KEY = 'dj-agent-sequence-sets'
export const SEQ_ROWS = 8
export const SEQ_STEPS = 16

export function emptyPattern(): boolean[][] {
  return Array.from({ length: SEQ_ROWS }, () => Array.from({ length: SEQ_STEPS }, () => false))
}

export function normalizePattern(raw: unknown): boolean[][] {
  const out = emptyPattern()
  if (!Array.isArray(raw)) return out
  for (let r = 0; r < SEQ_ROWS; r++) {
    const row = raw[r]
    if (!Array.isArray(row)) continue
    for (let s = 0; s < SEQ_STEPS; s++) {
      out[r][s] = !!row[s]
    }
  }
  return out
}

export function loadSequenceSets(): SequenceSetRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap(parseStoredRecord)
  } catch {
    return []
  }
}

function parseStoredRecord(item: unknown): SequenceSetRecord[] {
  if (!item || typeof item !== 'object') return []
  const o = item as Record<string, unknown>
  const id = typeof o.id === 'string' && o.id.length > 0 ? o.id : crypto.randomUUID()
  const nameRaw = typeof o.name === 'string' ? o.name.trim() : ''
  const name = nameRaw.length > 0 ? nameRaw : 'Untitled'
  const createdAt =
    typeof o.createdAt === 'string' && o.createdAt.length > 0 ? o.createdAt : new Date().toISOString()
  const bpmRaw = typeof o.bpm === 'number' && Number.isFinite(o.bpm) ? o.bpm : 120
  const bpm = Math.round(Math.min(180, Math.max(60, bpmRaw)))
  const pattern = normalizePattern(o.pattern)
  return [{ id, name, createdAt, bpm, pattern }]
}

export function saveSequenceSets(sets: SequenceSetRecord[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sets))
}

export function addSequenceSet(name: string, bpm: number, pattern: boolean[][]): SequenceSetRecord {
  const sets = loadSequenceSets()
  const record: SequenceSetRecord = {
    id: crypto.randomUUID(),
    name: name.trim().length > 0 ? name.trim() : 'Untitled',
    createdAt: new Date().toISOString(),
    bpm: Math.round(Math.min(180, Math.max(60, bpm))),
    pattern: normalizePattern(pattern),
  }
  sets.push(record)
  saveSequenceSets(sets)
  return record
}

export function deleteSequenceSet(id: string): void {
  saveSequenceSets(loadSequenceSets().filter((s) => s.id !== id))
}

/**
 * Parse exported sequence JSON ({ version?, name, bpm, pattern }) or library-shaped objects that include pattern[].
 * Returns null if `pattern` is missing or not an array (wrong file type).
 */
export function parseSequencePresetJson(obj: unknown): { name: string; bpm: number; pattern: boolean[][] } | null {
  if (!obj || typeof obj !== 'object') return null
  const o = obj as Record<string, unknown>
  if (!Array.isArray(o.pattern)) return null
  const nameRaw = typeof o.name === 'string' ? o.name.trim() : ''
  const name = nameRaw.length > 0 ? nameRaw : 'Preset'
  const bpmRaw = typeof o.bpm === 'number' && Number.isFinite(o.bpm) ? o.bpm : 120
  const bpm = Math.round(Math.min(180, Math.max(60, bpmRaw)))
  const pattern = normalizePattern(o.pattern)
  return { name, bpm, pattern }
}

/** Merge JSON file into library (new id). Returns null if invalid. */
export function importSequenceSetJson(obj: unknown): SequenceSetRecord | null {
  const parsed = parseSequencePresetJson(obj)
  if (!parsed) return null
  const record: SequenceSetRecord = {
    id: crypto.randomUUID(),
    name: parsed.name,
    createdAt: new Date().toISOString(),
    bpm: parsed.bpm,
    pattern: parsed.pattern,
  }
  const sets = loadSequenceSets()
  sets.push(record)
  saveSequenceSets(sets)
  return record
}

export function sequenceSetExportPayload(record: SequenceSetRecord): string {
  return JSON.stringify(
    { version: 1, name: record.name, bpm: record.bpm, pattern: record.pattern },
    null,
    2,
  )
}

export function downloadSequenceSet(record: SequenceSetRecord): void {
  const blob = new Blob([sequenceSetExportPayload(record)], { type: 'application/json' })
  const a = document.createElement('a')
  const safe = record.name.replace(/[^\w\s-]/g, '').slice(0, 48) || 'set'
  a.href = URL.createObjectURL(blob)
  a.download = `dj-sequence-${safe}.json`
  a.click()
  URL.revokeObjectURL(a.href)
}

export function pickAudioFile(files: FileList | null): File | null {
  if (!files?.length) return null
  for (let i = 0; i < files.length; i++) {
    const f = files.item(i)
    if (!f) continue
    if (f.type.startsWith('audio/')) return f
    const lower = f.name.toLowerCase()
    if (/\.(mp3|wav|ogg|flac|m4a|aac|webm)$/.test(lower)) return f
  }
  return null
}

export function isSequencePresetFile(file: File): boolean {
  return file.type === 'application/json' || file.name.toLowerCase().endsWith('.json')
}

/** First dropped sequence JSON if any, otherwise first usable audio file (deck loads). */
export function pickDeckLoadFile(files: FileList | null): File | null {
  if (!files?.length) return null
  for (let i = 0; i < files.length; i++) {
    const f = files.item(i)
    if (!f) continue
    if (isSequencePresetFile(f)) return f
  }
  return pickAudioFile(files)
}
