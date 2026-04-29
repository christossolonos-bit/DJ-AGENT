import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchSequenceFromLLM } from './llmSequence'
import { generateOfflineGroove } from './offlineGroove'

const STORAGE_KEY = 'dj-agent-openai-api-key'

type Msg = { role: 'user' | 'assistant'; text: string }

type Props = {
  ready: boolean
  onApplyPreset: (preset: { name: string; bpm: number; pattern: boolean[][] }) => void
}

export function MusicAssistantPanel({ ready, onApplyPreset }: Props) {
  const [messages, setMessages] = useState<Msg[]>([
    {
      role: 'assistant',
      text: 'Describe a groove (genre, BPM, vibe). I’ll fill the 8×16 sequencer — like a lighter Suno-style copilot for rhythm layers in this app. Full mastered vocals need an external generator.',
    },
  ])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [apiKey, setApiKey] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) ?? ''
    } catch {
      return ''
    }
  })
  const [showKey, setShowKey] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const persistKey = useCallback((k: string) => {
    setApiKey(k)
    try {
      if (k.trim()) localStorage.setItem(STORAGE_KEY, k.trim())
      else localStorage.removeItem(STORAGE_KEY)
    } catch {
      /* ignore */
    }
  }, [])

  const send = async () => {
    const trimmed = input.trim()
    if (!trimmed || busy || !ready) return

    setInput('')
    setMessages((m) => [...m, { role: 'user', text: trimmed }])
    setBusy(true)

    const tryLlm = apiKey.trim().length > 0

    try {
      if (tryLlm) {
        const preset = await fetchSequenceFromLLM(trimmed, apiKey.trim())
        onApplyPreset(preset)
        setMessages((m) => [
          ...m,
          {
            role: 'assistant',
            text: `Applied “${preset.name}” at ${preset.bpm} BPM to the sequencer. Scroll to Step sequencer and hit Start sequencer.`,
          },
        ])
      } else {
        const preset = generateOfflineGroove(trimmed)
        onApplyPreset(preset)
        setMessages((m) => [
          ...m,
          {
            role: 'assistant',
            text: `Applied offline groove “${preset.name}” (${preset.bpm} BPM). Add an OpenAI API key below and run npm run dev so requests use the Vite proxy — then prompts use a real LLM.`,
          },
        ])
      }
    } catch (err) {
      const preset = generateOfflineGroove(trimmed)
      onApplyPreset(preset)
      const hint =
        err instanceof Error ? err.message : 'Request failed'
      setMessages((m) => [
        ...m,
        {
          role: 'assistant',
          text: `AI request didn’t work (${hint}). I dropped an offline sketch instead (“${preset.name}”, ${preset.bpm} BPM). Fix key/proxy or keep iterating.`,
        },
      ])
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="dj-section dj-assistant">
      <h2 className="dj-h2">Music assistant</h2>
      <p className="dj-hint">
        Chat-driven grooves for this sequencer (drums, stab, bass lane). Unlike{' '}
        <a href="https://suno.ai" target="_blank" rel="noreferrer">
          Suno
        </a>
        , we don’t render full sung mixes here — we shape patterns you can hear instantly with decks and export.
      </p>

      <div className="dj-assistant-settings">
        <button type="button" className="dj-btn dj-assistant-toggle" onClick={() => setShowKey((v) => !v)}>
          {showKey ? 'Hide' : 'Show'} OpenAI API key (optional)
        </button>
        {showKey && (
          <label className="dj-field dj-assistant-key">
            Key stays in your browser (localStorage). Dev server proxies <code>/openai-proxy</code> → api.openai.com.
            <input
              type="password"
              autoComplete="off"
              placeholder="sk-…"
              value={apiKey}
              onChange={(e) => persistKey(e.target.value)}
            />
          </label>
        )}
      </div>

      <div className="dj-assistant-chat" role="log" aria-live="polite">
        {messages.map((msg, i) => (
          <div key={i} className={`dj-assistant-msg dj-assistant-msg-${msg.role}`}>
            <span className="dj-assistant-role">{msg.role === 'user' ? 'You' : 'Assistant'}</span>
            <p className="dj-assistant-text">{msg.text}</p>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="dj-assistant-compose">
        <textarea
          className="dj-assistant-input"
          rows={3}
          placeholder="e.g. Dark garage at 132 BPM, sparse hats, heavy kick on 1 and 3…"
          value={input}
          disabled={!ready || busy}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void send()
            }
          }}
        />
        <button type="button" className="dj-btn dj-btn-primary" disabled={!ready || busy || !input.trim()} onClick={() => void send()}>
          {busy ? 'Working…' : 'Generate → sequencer'}
        </button>
      </div>
    </section>
  )
}
