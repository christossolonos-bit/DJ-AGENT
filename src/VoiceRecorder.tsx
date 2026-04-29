import { useCallback, useEffect, useRef, useState } from 'react'
import type { DJEngine } from './audio/DJEngine'

function pickRecorderMime(): string | undefined {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
    'audio/ogg',
  ]
  for (const t of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) return t
  }
  return undefined
}

type Props = {
  ready: boolean
  engine: DJEngine | null
}

export function VoiceRecorderPanel({ ready, engine }: Props) {
  const [phase, setPhase] = useState<'idle' | 'recording' | 'done'>('idle')
  const [elapsedMs, setElapsedMs] = useState(0)
  const [slot, setSlot] = useState(7)
  const [lastBlob, setLastBlob] = useState<Blob | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [assignMsg, setAssignMsg] = useState<string | null>(null)
  const [micError, setMicError] = useState<string | null>(null)
  const [voiceClipGainDb, setVoiceClipGainDb] = useState(0)

  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<BlobPart[]>([])
  const tickRef = useRef<number>(0)
  const startedAtRef = useRef<number>(0)

  const revokePreview = useCallback(() => {
    setPreviewUrl((u) => {
      if (u) URL.revokeObjectURL(u)
      return null
    })
  }, [])

  useEffect(() => {
    return () => {
      revokePreview()
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
  }, [revokePreview])

  useEffect(() => {
    if (!engine?.isReady) return
    engine.setVoiceClipGainDb(voiceClipGainDb)
  }, [engine, voiceClipGainDb])

  const stopTimer = () => {
    if (tickRef.current) cancelAnimationFrame(tickRef.current)
    tickRef.current = 0
  }

  const startRecording = async () => {
    setMicError(null)
    setAssignMsg(null)
    revokePreview()
    setLastBlob(null)

    if (!ready || !engine?.isReady) {
      setMicError('Enable audio first.')
      return
    }

    if (typeof MediaRecorder === 'undefined') {
      setMicError('Recording is not supported in this browser.')
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
      streamRef.current = stream
      chunksRef.current = []

      const mimeType = pickRecorderMime()
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
      recorderRef.current = recorder

      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunksRef.current.push(ev.data)
      }

      recorder.onstop = () => {
        stopTimer()
        stream.getTracks().forEach((t) => t.stop())
        streamRef.current = null
        recorderRef.current = null

        const durationMs = Math.round(performance.now() - startedAtRef.current)
        setElapsedMs(durationMs)

        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || mimeType || 'audio/webm' })
        chunksRef.current = []

        if (blob.size === 0) {
          setPhase('idle')
          setMicError('Nothing captured — try again.')
          return
        }

        setLastBlob(blob)
        const url = URL.createObjectURL(blob)
        setPreviewUrl(url)
        setPhase('done')
      }

      recorder.start(120)
      setPhase('recording')
      startedAtRef.current = performance.now()
      const tick = () => {
        setElapsedMs(Math.round(performance.now() - startedAtRef.current))
        tickRef.current = requestAnimationFrame(tick)
      }
      tickRef.current = requestAnimationFrame(tick)
    } catch (err) {
      setMicError(
        err instanceof Error
          ? err.name === 'NotAllowedError'
            ? 'Microphone permission denied.'
            : err.message
          : 'Could not access microphone.',
      )
      setPhase('idle')
      stopTimer()
    }
  }

  const stopRecording = () => {
    const rec = recorderRef.current
    if (rec && rec.state !== 'inactive') rec.stop()
  }

  const discardClip = () => {
    revokePreview()
    setLastBlob(null)
    setPhase('idle')
    setElapsedMs(0)
    setAssignMsg(null)
    setMicError(null)
  }

  const assignToPad = async () => {
    if (!lastBlob || !engine?.isReady) return
    setAssignMsg(null)
    setMicError(null)
    try {
      await engine.loadPadBlob(slot, lastBlob, `voice-${Date.now()}`)
      setAssignMsg(
        `Clip is on pad ${slot + 1} (voice bus). Press that pad to play it; use Voice clip level above to sit it in the mix.`,
      )
    } catch (err) {
      setMicError(err instanceof Error ? err.message : 'Could not load clip into sampler.')
    }
  }

  const downloadClip = () => {
    if (!lastBlob || !previewUrl) return
    const ext = lastBlob.type.includes('webm') ? 'webm' : lastBlob.type.includes('mp4') ? 'm4a' : 'ogg'
    const a = document.createElement('a')
    a.href = previewUrl
    a.download = `voice-clip.${ext}`
    a.click()
  }

  const fmtTime = (ms: number) => {
    const s = Math.floor(ms / 1000)
    const m = Math.floor(s / 60)
    const r = s % 60
    return `${m}:${r.toString().padStart(2, '0')}`
  }

  return (
    <section className="dj-section dj-voice">
      <h2 className="dj-h2">Voice recorder</h2>
      <p className="dj-hint">
        Capture spoken hooks, shouts, or scratch vocals. Grant microphone access when prompted. Works on HTTPS or localhost.
        Clips you assign to pads use a separate mix bus from file-loaded samples so you can balance them cleanly.
      </p>
      <label className="dj-field dj-voice-gain">
        Voice clip level (in mix)
        <div className="dj-voice-gain-row">
          <input
            type="range"
            min={-24}
            max={12}
            step={1}
            value={voiceClipGainDb}
            disabled={!ready}
            onChange={(e) => setVoiceClipGainDb(Number(e.target.value))}
          />
          <span className="dj-voice-gain-val">
            {voiceClipGainDb > 0 ? '+' : ''}
            {voiceClipGainDb} dB
          </span>
        </div>
      </label>
      {micError && <p className="dj-error">{micError}</p>}
      <div className="dj-voice-row">
        {phase === 'recording' ? (
          <>
            <button type="button" className="dj-btn dj-btn-warn dj-voice-recbtn" onClick={stopRecording}>
              Stop recording
            </button>
            <span className="dj-voice-live">
              <span className="dj-voice-dot" aria-hidden />
              Recording {fmtTime(elapsedMs)}
            </span>
          </>
        ) : (
          <button type="button" className="dj-btn dj-btn-primary dj-voice-recbtn" disabled={!ready} onClick={startRecording}>
            Record voice clip
          </button>
        )}
      </div>

      {phase === 'done' && lastBlob && previewUrl && (
        <div className="dj-voice-result">
          <p className="dj-voice-meta">
            Clip ready · {fmtTime(elapsedMs)} · ~{Math.max(1, Math.round(lastBlob.size / 1024))} KB
          </p>
          <audio className="dj-voice-audio" controls src={previewUrl} preload="metadata" />
          <div className="dj-voice-assign">
            <label className="dj-field dj-voice-slot">
              Sampler pad
              <select value={slot} onChange={(e) => setSlot(Number(e.target.value))}>
                {Array.from({ length: 8 }, (_, i) => (
                  <option key={i} value={i}>
                    Pad {i + 1}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="dj-btn dj-btn-primary" disabled={!engine?.isReady} onClick={() => void assignToPad()}>
              Put clip on pad
            </button>
            <button type="button" className="dj-btn" onClick={downloadClip}>
              Download file
            </button>
            <button type="button" className="dj-btn" onClick={discardClip}>
              Discard
            </button>
          </div>
          {assignMsg && <p className="dj-lib-msg">{assignMsg}</p>}
        </div>
      )}
    </section>
  )
}
