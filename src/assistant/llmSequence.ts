import { parseSequencePresetJson } from '../sequenceSets'

export const SEQUENCE_ASSISTANT_SYSTEM = `You are a groove programmer for a browser drum machine / DJ sequencer.

Output MUST be a single JSON object only (no markdown, no prose before or after). Use this exact shape:
{
  "name": "short descriptive title",
  "bpm": 72,
  "pattern": [
    [ /* row 0: Kick — 16 booleans */ ],
    [ /* row 1: Snare */ ],
    [ /* row 2: Hi-hat */ ],
    [ /* row 3: Clap */ ],
    [ /* row 4: Tom */ ],
    [ /* row 5: Percussion */ ],
    [ /* row 6: Stab (bright synth hit) */ ],
    [ /* row 7: Bass hit */ ]
  ]
}

Rules:
- Exactly 8 rows × 16 steps. Each value must be true or false (not strings).
- Step indices 0,4,8,12 are quarter-note downbeats in 4/4.
- Respect the user's genre, density, and BPM hints from their message.
- If they ask for "four on the floor", put kicks on beats 1–4 (steps 0,4,8,12).
- Snare/clap often on steps 4 and 12 unless they ask otherwise.
- Keep hats musical: sparse (every 8th), medium (every 4th), or busy (eighth-notes).
- BPM must be between 60 and 180.

Remember: reply with ONLY the JSON object.`

export function extractJsonFromAssistantReply(text: string): unknown | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const slice = fenced ? fenced[1].trim() : text.trim()
  const start = slice.indexOf('{')
  const end = slice.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    return JSON.parse(slice.slice(start, end + 1)) as unknown
  } catch {
    return null
  }
}

function resolveChatUrl(): string {
  const raw = import.meta.env.VITE_OPENAI_PROXY_URL as string | undefined
  if (raw !== undefined && String(raw).trim() !== '') {
    return `${String(raw).replace(/\/$/, '')}/v1/chat/completions`
  }
  if (import.meta.env.DEV) return '/openai-proxy/v1/chat/completions'
  return ''
}

export async function fetchSequenceFromLLM(
  userPrompt: string,
  apiKey: string,
): Promise<{ name: string; bpm: number; pattern: boolean[][] }> {
  const url = resolveChatUrl()
  if (!url) {
    throw new Error(
      'No AI endpoint: run `npm run dev` (uses Vite proxy) or set VITE_OPENAI_PROXY_URL to your OpenAI-compatible base.',
    )
  }
  const model =
    (import.meta.env.VITE_ASSISTANT_MODEL as string | undefined)?.trim() || 'gpt-4o-mini'

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: SEQUENCE_ASSISTANT_SYSTEM },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.75,
      max_tokens: 2500,
    }),
  })

  if (!res.ok) {
    const errBody = await res.text()
    throw new Error(`${res.status} ${errBody.slice(0, 280)}`)
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const content = data.choices?.[0]?.message?.content
  if (!content || typeof content !== 'string') throw new Error('Empty model reply')

  const parsed = extractJsonFromAssistantReply(content)
  if (!parsed) throw new Error('Model did not return valid JSON')

  const preset = parseSequencePresetJson(parsed)
  if (!preset) throw new Error('JSON missing an 8×16 boolean pattern')
  return preset
}
