import { emptyPattern, SEQ_STEPS } from '../sequenceSets'

/** Simple deterministic-ish groove when no LLM is available or request fails. */
export function generateOfflineGroove(prompt: string): { name: string; bpm: number; pattern: boolean[][] } {
  const lower = prompt.toLowerCase()
  const bpmMatch = prompt.match(/\b(\d{2,3})\s*bpm\b/i)
  let bpm = bpmMatch ? Number.parseInt(bpmMatch[1], 10) : 120
  if (!Number.isFinite(bpm)) bpm = 120
  bpm = Math.round(Math.min(180, Math.max(60, bpm)))

  const pattern = emptyPattern()

  const fourOnFloor = /four[\s-]?on[\s-]?the[\s-]?floor|house|techno|edm|club/i.test(lower)
  const dnb = /drum\s*&?\s*bass|jungle|dnb|break/i.test(lower)
  const sparse = /sparse|minimal|ambient|slow/i.test(lower)
  const busy = /busy|dense|trap|fast\s+hihat/i.test(lower)

  const kickRow = 0
  const snareRow = 1
  const hatRow = 2
  const clapRow = 3
  const tomRow = 4
  const percRow = 5
  const stabRow = 6
  const bassRow = 7

  if (fourOnFloor && !/no\s*kicks?/i.test(lower)) {
    for (let s = 0; s < SEQ_STEPS; s += 4) pattern[kickRow][s] = true
  } else if (dnb) {
    ;[0, 3, 8, 11].forEach((s) => {
      pattern[kickRow][s % SEQ_STEPS] = true
    })
  } else {
    pattern[kickRow][0] = true
    pattern[kickRow][8] = true
  }

  if (!/no\s*snare/i.test(lower)) {
    pattern[snareRow][4] = true
    pattern[snareRow][12] = true
  }

  const hatPeriod = busy ? 2 : sparse ? 8 : 4
  if (!/no\s*hihat|no\s*hat/i.test(lower)) {
    for (let s = 0; s < SEQ_STEPS; s += hatPeriod) pattern[hatRow][s] = true
  }

  if (/clap/i.test(lower)) {
    pattern[clapRow][4] = pattern[clapRow][12] = true
  }

  if (/tom|fill/i.test(lower)) {
    pattern[tomRow][14] = pattern[tomRow][15] = true
  }

  if (/perc|shaker/i.test(lower)) {
    for (let s = 2; s < SEQ_STEPS; s += 4) pattern[percRow][s] = true
  }

  if (/stab|chord/i.test(lower)) {
    pattern[stabRow][0] = pattern[stabRow][8] = true
  }

  if (!/no\s*bass/i.test(lower)) {
    pattern[bassRow][0] = true
    pattern[bassRow][6] = true
    pattern[bassRow][10] = true
  }

  const seed = prompt.split('').reduce((a, c) => a + c.charCodeAt(0), 0)
  const rng = (i: number) => Math.abs(Math.sin(seed + i * 12.9898) * 43758.5453) % 1
  if (busy) {
    for (let i = 0; i < 6; i++) {
      const s = Math.floor(rng(i) * SEQ_STEPS)
      pattern[percRow][s] = true
    }
  }

  const shortName =
    prompt.trim().slice(0, 42) + (prompt.trim().length > 42 ? '…' : '') || 'Groove sketch'

  return {
    name: `Sketch: ${shortName}`,
    bpm,
    pattern,
  }
}
