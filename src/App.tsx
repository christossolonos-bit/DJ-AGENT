import { useCallback, useEffect, useRef, useState } from 'react'
import { DJEngine, type DeckId } from './audio/DJEngine'
import {
  addSequenceSet,
  deleteSequenceSet,
  downloadSequenceSet,
  emptyPattern,
  importSequenceSetJson,
  loadSequenceSets,
  parseSequencePresetJson,
  isSequencePresetFile,
  pickDeckLoadFile,
  type SequenceSetRecord,
} from './sequenceSets'
import { VoiceRecorderPanel } from './VoiceRecorder'
import './App.css'

const DECK_LABEL: Record<DeckId, string> = { A: 'Deck A', B: 'Deck B' }

const KEY_ROW = ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5', 'D5', 'E5', 'F5', 'G5']
const BASS_ROW = ['C2', 'D2', 'E2', 'F2', 'G2', 'A2', 'B2', 'C3']
const SEQ_ROW_LABELS = ['Kick', 'Snare', 'Hat', 'Clap', 'Tom', 'Perc', 'Stab', 'Bass']

function App() {
  const [engine, setEngine] = useState<DJEngine | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [decks, setDecks] = useState({
    A: { pos: 0, dur: 0 },
    B: { pos: 0, dur: 0 },
  })

  const [crossfader, setCrossfader] = useState(0.5)
  const [masterDb, setMasterDb] = useState(0)
  const [filterHz, setFilterHz] = useState(12000)

  const [eqA, setEqA] = useState({ low: 0, mid: 0, high: 0 })
  const [eqB, setEqB] = useState({ low: 0, mid: 0, high: 0 })
  const [trimA, setTrimA] = useState(0)
  const [trimB, setTrimB] = useState(0)

  const [rateA, setRateA] = useState(1)
  const [rateB, setRateB] = useState(1)
  const [loopA, setLoopA] = useState(false)
  const [loopB, setLoopB] = useState(false)

  const [seqBpm, setSeqBpm] = useState(120)
  const [seqOn, setSeqOn] = useState(false)
  const [pattern, setPattern] = useState<boolean[][]>(emptyPattern)
  const [deckAudio, setDeckAudio] = useState<{ A: string | null; B: string | null }>({ A: null, B: null })
  const [deckSeqPreset, setDeckSeqPreset] = useState<{ A: string | null; B: string | null }>({
    A: null,
    B: null,
  })
  const [savedSets, setSavedSets] = useState<SequenceSetRecord[]>(() => loadSequenceSets())
  const [newSetName, setNewSetName] = useState('')
  const [setLibraryMsg, setSetLibraryMsg] = useState<string | null>(null)
  const [mixRecording, setMixRecording] = useState(false)
  const [mixElapsedMs, setMixElapsedMs] = useState(0)
  const [mixDownMsg, setMixDownMsg] = useState<string | null>(null)
  const mixClockStartRef = useRef(0)

  const refreshSavedSets = useCallback(() => {
    setSavedSets(loadSequenceSets())
  }, [])

  const enableAudio = useCallback(async () => {
    setError(null)
    try {
      const e = new DJEngine()
      await e.initialize()
      e.setCrossfader(crossfader)
      e.setMasterDb(masterDb)
      e.setMasterFilterHz(filterHz)
      setDeckAudio({ A: null, B: null })
      setDeckSeqPreset({ A: null, B: null })
      setPattern((prev) => {
        e.setSequencerPattern(prev)
        return prev
      })
      setEngine(e)
      setReady(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start audio')
    }
  }, [crossfader, masterDb, filterHz])

  useEffect(() => {
    if (!engine?.isReady) return
    let id = 0
    const loop = () => {
      setDecks({
        A: { pos: engine.getDeckPosition('A'), dur: engine.getDeckDuration('A') },
        B: { pos: engine.getDeckPosition('B'), dur: engine.getDeckDuration('B') },
      })
      id = requestAnimationFrame(loop)
    }
    id = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(id)
  }, [engine])

  useEffect(() => {
    if (!mixRecording) return
    mixClockStartRef.current = performance.now()
    let id = 0
    const loop = () => {
      setMixElapsedMs(Math.round(performance.now() - mixClockStartRef.current))
      id = requestAnimationFrame(loop)
    }
    id = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(id)
  }, [mixRecording])

  useEffect(() => {
    const onLeave = () => {
      setEngine((eng) => {
        eng?.dispose()
        return null
      })
      setReady(false)
    }
    window.addEventListener('pagehide', onLeave)
    return () => window.removeEventListener('pagehide', onLeave)
  }, [])

  useEffect(() => {
    if (!engine?.isReady) return
    engine.setCrossfader(crossfader)
  }, [crossfader, engine])

  useEffect(() => {
    if (!engine?.isReady) return
    engine.setMasterDb(masterDb)
  }, [masterDb, engine])

  useEffect(() => {
    if (!engine?.isReady) return
    engine.setMasterFilterHz(filterHz)
  }, [filterHz, engine])

  useEffect(() => {
    if (!engine?.isReady) return
    engine.setDeckEq('A', eqA.low, eqA.mid, eqA.high)
  }, [eqA, engine])

  useEffect(() => {
    if (!engine?.isReady) return
    engine.setDeckEq('B', eqB.low, eqB.mid, eqB.high)
  }, [eqB, engine])

  useEffect(() => {
    if (!engine?.isReady) return
    engine.setDeckTrimDb('A', trimA)
  }, [trimA, engine])

  useEffect(() => {
    if (!engine?.isReady) return
    engine.setDeckTrimDb('B', trimB)
  }, [trimB, engine])

  useEffect(() => {
    if (!engine?.isReady) return
    engine.setDeckRate('A', rateA)
  }, [rateA, engine])

  useEffect(() => {
    if (!engine?.isReady) return
    engine.setDeckRate('B', rateB)
  }, [rateB, engine])

  useEffect(() => {
    if (!engine?.isReady) return
    engine.setDeckLoop('A', loopA)
  }, [loopA, engine])

  useEffect(() => {
    if (!engine?.isReady) return
    engine.setDeckLoop('B', loopB)
  }, [loopB, engine])

  const loadDeck = async (deck: DeckId, file: File | null) => {
    if (!file || !engine?.isReady) return
    setError(null)

    if (isSequencePresetFile(file)) {
      try {
        const text = await file.text()
        const data = JSON.parse(text) as unknown
        const preset = parseSequencePresetJson(data)
        if (!preset) {
          setError('Invalid sequence JSON — use an exported preset with a "pattern" array (and bpm).')
          return
        }
        if (engine.sequencerRunning) {
          engine.stopSequencer()
          setSeqOn(false)
        }
        const pat = preset.pattern.map((row) => [...row])
        setPattern(pat)
        setSeqBpm(preset.bpm)
        engine.setSequencerPattern(pat)
        engine.setSequencerBpm(preset.bpm)
        setDeckSeqPreset((prev) => ({
          ...prev,
          [deck]: preset.name,
        }))
        setSetLibraryMsg(
          `${deck === 'A' ? 'Deck A' : 'Deck B'} loaded sequence “${preset.name}” (${preset.bpm} BPM). Start sequencer when you want it running.`,
        )
      } catch {
        setError('Could not read that JSON file.')
      }
      return
    }

    try {
      await engine.loadDeckFile(deck, file)
      setDeckAudio((prev) => ({ ...prev, [deck]: file.name }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Load failed')
    }
  }

  const applySequenceSet = useCallback(
    (record: SequenceSetRecord) => {
      if (engine?.sequencerRunning) {
        engine.stopSequencer()
        setSeqOn(false)
      }
      const pat = record.pattern.map((row) => [...row])
      setPattern(pat)
      setSeqBpm(record.bpm)
      engine?.setSequencerPattern(pat)
      engine?.setSequencerBpm(record.bpm)
      setSetLibraryMsg(`Loaded “${record.name}”.`)
    },
    [engine],
  )

  const saveCurrentSequenceSet = () => {
    const name = newSetName.trim()
    if (!name) {
      setSetLibraryMsg('Enter a name before saving.')
      return
    }
    addSequenceSet(name, seqBpm, pattern)
    setNewSetName('')
    refreshSavedSets()
    setSetLibraryMsg(`Saved “${name}” to your library (this browser).`)
  }

  const removeSavedSet = (id: string) => {
    deleteSequenceSet(id)
    refreshSavedSets()
    setSetLibraryMsg('Set removed.')
  }

  const importSetFromFile = async (file: File | null) => {
    if (!file) return
    setSetLibraryMsg(null)
    try {
      const text = await file.text()
      const data = JSON.parse(text) as unknown
      const rec = importSequenceSetJson(data)
      if (!rec) {
        setSetLibraryMsg('Invalid JSON — need name, bpm, and pattern.')
        return
      }
      refreshSavedSets()
      applySequenceSet(rec)
      setSetLibraryMsg(`Imported and loaded “${rec.name}”.`)
    } catch {
      setSetLibraryMsg('Could not read that file.')
    }
  }

  const onSeek = (deck: DeckId, frac: number) => {
    const d = deck === 'A' ? decks.A.dur : decks.B.dur
    if (d <= 0 || !engine?.isReady) return
    engine.deckSeek(deck, frac * d)
  }

  const toggleSeq = () => {
    if (!engine?.isReady) return
    if (engine.sequencerRunning) {
      engine.stopSequencer()
      setSeqOn(false)
    } else {
      engine.setSequencerBpm(seqBpm)
      engine.startSequencer()
      setSeqOn(true)
    }
  }

  const applySeqBpm = () => {
    engine?.setSequencerBpm(seqBpm)
  }

  const toggleStep = (row: number, step: number) => {
    engine?.toggleSequencerStep(row, step)
    setPattern((p) => {
      const next = p.map((r) => [...r])
      if (next[row]?.[step] === undefined) return p
      next[row][step] = !next[row][step]
      return next
    })
  }

  const fmtMixClock = (ms: number) => {
    const s = Math.floor(ms / 1000)
    const m = Math.floor(s / 60)
    const r = s % 60
    return `${m}:${r.toString().padStart(2, '0')}`
  }

  const startMixCapture = () => {
    if (!engine?.isReady) return
    setMixDownMsg(null)
    try {
      engine.startMixRecording()
      setMixRecording(true)
      setMixElapsedMs(0)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start mix recording')
    }
  }

  const stopMixCapture = async () => {
    if (!engine?.isReady) return
    try {
      const blob = await engine.stopMixRecording()
      setMixRecording(false)
      setMixElapsedMs(0)
      const ext = blob.type.includes('webm') ? 'webm' : blob.type.includes('mp4') ? 'm4a' : 'ogg'
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `dj-set-mix-${Date.now()}.${ext}`
      a.click()
      URL.revokeObjectURL(url)
      setMixDownMsg(`Download started (${Math.round(blob.size / 1024)} KB). Import this file into any DAW or use it like a normal track.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Mix export failed')
      setMixRecording(false)
    }
  }

  return (
    <div className="dj-app">
      <header className="dj-header">
        <div>
          <h1 className="dj-title">DJ Set</h1>
          <p className="dj-sub">
            Decks, mixer, drums, keys, bass, sequencer, and voice clips — layer everything live, then export one mixed file when you are ready.
          </p>
        </div>
        {!ready ? (
          <button type="button" className="dj-btn dj-btn-primary" onClick={enableAudio}>
            Enable audio
          </button>
        ) : (
          <span className="dj-badge">Audio on</span>
        )}
      </header>

      {error && <p className="dj-error">{error}</p>}

      <section className="dj-section dj-mix-export">
        <h2 className="dj-h2">Combine into one track (mix export)</h2>
        <p className="dj-hint">
          While playing, everything already mixes together through the master — exactly what you hear (after master level and filter). Use{' '}
          <strong>Record mix</strong>, perform your piece (decks, sequencer, pads, keys, bass, voice pads), then{' '}
          <strong>Stop &amp; download</strong> to save a single audio file you can trim or master elsewhere.
        </p>
        <div className="dj-mix-row">
          {!mixRecording ? (
            <button type="button" className="dj-btn dj-btn-primary" disabled={!ready} onClick={startMixCapture}>
              Record mix
            </button>
          ) : (
            <>
              <button type="button" className="dj-btn dj-btn-warn" onClick={() => void stopMixCapture()}>
                Stop &amp; download mix
              </button>
              <span className="dj-voice-live">
                <span className="dj-voice-dot" aria-hidden />
                Capturing {fmtMixClock(mixElapsedMs)}
              </span>
            </>
          )}
        </div>
        {mixDownMsg && <p className="dj-lib-msg">{mixDownMsg}</p>}
      </section>

      <section className="dj-decks">
        <DeckPanel
          label={DECK_LABEL.A}
          ready={ready}
          audioTrackName={deckAudio.A}
          sequencePresetName={deckSeqPreset.A}
          rate={rateA}
          setRate={setRateA}
          loop={loopA}
          setLoop={setLoopA}
          onLoad={(f) => loadDeck('A', f)}
          onPlay={() => engine?.deckPlay('A')}
          onPause={() => engine?.deckPause('A')}
          onStop={() => engine?.deckStop('A')}
          position={decks.A.pos}
          duration={decks.A.dur}
          onSeek={(frac) => onSeek('A', frac)}
        />
        <MixerPanel
          crossfader={crossfader}
          setCrossfader={setCrossfader}
          masterDb={masterDb}
          setMasterDb={setMasterDb}
          filterHz={filterHz}
          setFilterHz={setFilterHz}
          eqA={eqA}
          setEqA={setEqA}
          eqB={eqB}
          setEqB={setEqB}
          trimA={trimA}
          setTrimA={setTrimA}
          trimB={trimB}
          setTrimB={setTrimB}
        />
        <DeckPanel
          label={DECK_LABEL.B}
          ready={ready}
          audioTrackName={deckAudio.B}
          sequencePresetName={deckSeqPreset.B}
          rate={rateB}
          setRate={setRateB}
          loop={loopB}
          setLoop={setLoopB}
          onLoad={(f) => loadDeck('B', f)}
          onPlay={() => engine?.deckPlay('B')}
          onPause={() => engine?.deckPause('B')}
          onStop={() => engine?.deckStop('B')}
          position={decks.B.pos}
          duration={decks.B.dur}
          onSeek={(frac) => onSeek('B', frac)}
        />
      </section>

      <section className="dj-section">
        <h2 className="dj-h2">Sampler pads</h2>
        <p className="dj-hint">Slots 1–6 are drums by default; 7–8 are stab and low hit. Drop a sample on a pad to replace it.</p>
        <div className="dj-pads">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="dj-pad-wrap">
              <button type="button" className="dj-pad" disabled={!ready} onMouseDown={() => engine?.triggerPad(i)}>
                {i + 1}
              </button>
              <label className="dj-pad-file">
                <input
                  type="file"
                  accept="audio/*"
                  disabled={!ready}
                  onChange={(ev) => {
                    const f = ev.target.files?.[0]
                    if (f) void engine?.loadPadSample(i, f)
                    ev.target.value = ''
                  }}
                />
                Load
              </label>
            </div>
          ))}
        </div>
      </section>

      <VoiceRecorderPanel ready={ready} engine={engine} />

      <section className="dj-section dj-grid-2">
        <div>
          <h2 className="dj-h2">Keys</h2>
          <div className="dj-keys">
            {KEY_ROW.map((note) => (
              <button key={note} type="button" className="dj-key" disabled={!ready} onMouseDown={() => engine?.triggerKey(note)}>
                {note}
              </button>
            ))}
          </div>
        </div>
        <div>
          <h2 className="dj-h2">Bass</h2>
          <div className="dj-keys">
            {BASS_ROW.map((note) => (
              <button
                key={note}
                type="button"
                className="dj-key dj-key-bass"
                disabled={!ready}
                onMouseDown={() => engine?.triggerBass(note)}
              >
                {note}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="dj-section">
        <h2 className="dj-h2">Step sequencer</h2>
        <div className="dj-seq-controls">
          <label className="dj-field">
            BPM
            <input
              type="number"
              min={60}
              max={180}
              value={seqBpm}
              onChange={(e) => setSeqBpm(Number(e.target.value))}
              onBlur={applySeqBpm}
            />
          </label>
          <button type="button" className="dj-btn" disabled={!ready} onClick={applySeqBpm}>
            Apply BPM
          </button>
          <button type="button" className={seqOn ? 'dj-btn dj-btn-warn' : 'dj-btn dj-btn-primary'} disabled={!ready} onClick={toggleSeq}>
            {seqOn ? 'Stop sequencer' : 'Start sequencer'}
          </button>
        </div>

        <div className="dj-set-library">
          <h3 className="dj-h3">Saved sequence sets</h3>
          <p className="dj-hint">Store rhythm patterns + BPM here to reuse later with different deck tracks. Data stays in this browser unless you export.</p>
          {setLibraryMsg && <p className="dj-lib-msg">{setLibraryMsg}</p>}
          <div className="dj-set-save-row">
            <label className="dj-field dj-set-name-field">
              Name this pattern
              <input
                type="text"
                placeholder="e.g. House groove + vocal chop"
                value={newSetName}
                maxLength={80}
                onChange={(e) => setNewSetName(e.target.value)}
              />
            </label>
            <button type="button" className="dj-btn dj-btn-primary" onClick={saveCurrentSequenceSet}>
              Save current sequence
            </button>
            <label className="dj-btn dj-btn-file">
              Import .json
              <input
                type="file"
                accept=".json,application/json"
                className="dj-hidden-input"
                onChange={(e) => {
                  void importSetFromFile(e.target.files?.[0] ?? null)
                  e.target.value = ''
                }}
              />
            </label>
          </div>
          {savedSets.length === 0 ? (
            <p className="dj-hint">No saved sets yet.</p>
          ) : (
            <ul className="dj-set-list">
              {[...savedSets]
                .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
                .map((rec) => (
                  <li key={rec.id} className="dj-set-item">
                    <div className="dj-set-meta">
                      <strong className="dj-set-name">{rec.name}</strong>
                      <span className="dj-set-detail">
                        {rec.bpm} BPM · {new Date(rec.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <div className="dj-set-actions">
                      <button type="button" className="dj-btn dj-btn-primary" disabled={!ready} onClick={() => applySequenceSet(rec)}>
                        Load
                      </button>
                      <button type="button" className="dj-btn" onClick={() => downloadSequenceSet(rec)}>
                        Export
                      </button>
                      <button type="button" className="dj-btn dj-btn-danger" onClick={() => removeSavedSet(rec.id)}>
                        Delete
                      </button>
                    </div>
                  </li>
                ))}
            </ul>
          )}
        </div>

        <div className="dj-seq">
          <div className="dj-seq-labels">
            {SEQ_ROW_LABELS.map((lab) => (
              <div key={lab} className="dj-seq-lab">
                {lab}
              </div>
            ))}
          </div>
          <div className="dj-seq-grid">
            {SEQ_ROW_LABELS.map((_, row) => (
              <div key={row} className="dj-seq-row">
                {Array.from({ length: 16 }, (_, step) => {
                  const on = pattern[row]?.[step]
                  const beat = step % 4 === 0
                  return (
                    <button
                      type="button"
                      key={step}
                      className={`dj-step${on ? ' is-on' : ''}${beat ? ' is-beat' : ''}`}
                      disabled={!ready}
                      onClick={() => toggleStep(row, step)}
                      aria-pressed={on}
                    />
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}

function DeckPanel(props: {
  label: string
  ready: boolean
  audioTrackName: string | null
  sequencePresetName: string | null
  rate: number
  setRate: (v: number) => void
  loop: boolean
  setLoop: (v: boolean) => void
  onLoad: (f: File | null) => void
  onPlay: () => void
  onPause: () => void
  onStop: () => void
  position: number
  duration: number
  onSeek: (frac: number) => void
}) {
  const {
    label,
    ready,
    audioTrackName,
    sequencePresetName,
    rate,
    setRate,
    loop,
    setLoop,
    onLoad,
    onPlay,
    onPause,
    onStop,
    position,
    duration,
    onSeek,
  } = props
  const [dragOver, setDragOver] = useState(false)
  const frac = duration > 0 ? position / duration : 0

  return (
    <div className="dj-deck">
      <h2 className="dj-deck-title">{label}</h2>
      <div className="dj-deck-track">
        <p className="dj-deck-track-line">
          {audioTrackName ? <>Audio: {audioTrackName}</> : <>No audio file on this deck</>}
        </p>
        {sequencePresetName && (
          <p className="dj-deck-track-line dj-deck-track-seq">
            Sequence preset (via JSON): <strong>{sequencePresetName}</strong>
          </p>
        )}
      </div>
      <div
        className={`dj-deck-drop${dragOver ? ' is-dragover' : ''}${!ready ? ' is-disabled' : ''}`}
        onDragEnter={(e) => {
          e.preventDefault()
          if (ready) setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDragOver={(e) => {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
        }}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          const file = pickDeckLoadFile(e.dataTransfer.files)
          if (file) onLoad(file)
        }}
      >
        <p className="dj-deck-drop-title">Audio track or sequence preset (.json)</p>
        <p className="dj-deck-drop-hint">
          Drag & drop <strong>audio</strong> (.mp3, .wav, …) or a <strong>sequence preset</strong> (.json), or browse.
        </p>
        <label className="dj-btn dj-btn-primary dj-deck-browse">
          Browse audio or sequence (.json)
          <input
            type="file"
            accept="audio/*,.mp3,.wav,.ogg,.flac,.m4a,.aac,.webm,.json,application/json"
            disabled={!ready}
            className="dj-hidden-input"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null
              const ok =
                f &&
                (f.type.startsWith('audio/') ||
                  /\.(mp3|wav|ogg|flac|m4a|aac|webm)$/i.test(f.name) ||
                  f.type === 'application/json' ||
                  f.name.toLowerCase().endsWith('.json'))
              onLoad(ok ? f : null)
              e.target.value = ''
            }}
          />
        </label>
      </div>
      <div className="dj-deck-transport">
        <button type="button" className="dj-btn dj-btn-primary" disabled={!ready} onClick={onPlay}>
          Play
        </button>
        <button type="button" className="dj-btn" disabled={!ready} onClick={onPause}>
          Pause
        </button>
        <button type="button" className="dj-btn" disabled={!ready} onClick={onStop}>
          Stop
        </button>
        <label className="dj-check">
          <input type="checkbox" checked={loop} disabled={!ready} onChange={(e) => setLoop(e.target.checked)} />
          Loop
        </label>
      </div>
      <div className="dj-progress-wrap">
        <div
          className="dj-progress"
          onClick={(e) => {
            const r = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
            onSeek(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)))
          }}
          role="slider"
          tabIndex={0}
          aria-valuenow={Math.round(frac * 100)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') onSeek(Math.min(1, frac + 0.02))
            if (e.key === 'ArrowLeft') onSeek(Math.max(0, frac - 0.02))
          }}
        >
          <div className="dj-progress-fill" style={{ width: `${frac * 100}%` }} />
        </div>
        <span className="dj-time">
          {formatTime(position)} / {formatTime(duration)}
        </span>
      </div>
      <label className="dj-field">
        Rate {rate.toFixed(2)}×
        <input type="range" min={0.5} max={1.5} step={0.01} value={rate} disabled={!ready} onChange={(e) => setRate(Number(e.target.value))} />
      </label>
    </div>
  )
}

function MixerPanel(props: {
  crossfader: number
  setCrossfader: (v: number) => void
  masterDb: number
  setMasterDb: (v: number) => void
  filterHz: number
  setFilterHz: (v: number) => void
  eqA: { low: number; mid: number; high: number }
  setEqA: (v: { low: number; mid: number; high: number }) => void
  eqB: { low: number; mid: number; high: number }
  setEqB: (v: { low: number; mid: number; high: number }) => void
  trimA: number
  setTrimA: (v: number) => void
  trimB: number
  setTrimB: (v: number) => void
}) {
  const {
    crossfader,
    setCrossfader,
    masterDb,
    setMasterDb,
    filterHz,
    setFilterHz,
    eqA,
    setEqA,
    eqB,
    setEqB,
    trimA,
    setTrimA,
    trimB,
    setTrimB,
  } = props

  return (
    <div className="dj-mixer">
      <h2 className="dj-mixer-title">Mixer</h2>
      <label className="dj-field">
        Crossfader — A ← → B
        <input type="range" min={0} max={1} step={0.01} value={crossfader} onChange={(e) => setCrossfader(Number(e.target.value))} />
      </label>
      <label className="dj-field">
        Master {masterDb > 0 ? '+' : ''}
        {masterDb} dB
        <input type="range" min={-24} max={12} step={1} value={masterDb} onChange={(e) => setMasterDb(Number(e.target.value))} />
      </label>
      <label className="dj-field">
        Filter {Math.round(filterHz)} Hz
        <input type="range" min={400} max={12000} step={50} value={filterHz} onChange={(e) => setFilterHz(Number(e.target.value))} />
      </label>
      <div className="dj-eq-grid">
        <div>
          <h3 className="dj-h3">A trim / EQ</h3>
          <label className="dj-field">
            Trim {trimA} dB
            <input type="range" min={-24} max={12} step={1} value={trimA} onChange={(e) => setTrimA(Number(e.target.value))} />
          </label>
          <EqSliders eq={eqA} setEq={setEqA} />
        </div>
        <div>
          <h3 className="dj-h3">B trim / EQ</h3>
          <label className="dj-field">
            Trim {trimB} dB
            <input type="range" min={-24} max={12} step={1} value={trimB} onChange={(e) => setTrimB(Number(e.target.value))} />
          </label>
          <EqSliders eq={eqB} setEq={setEqB} />
        </div>
      </div>
    </div>
  )
}

function EqSliders(props: {
  eq: { low: number; mid: number; high: number }
  setEq: (v: { low: number; mid: number; high: number }) => void
}) {
  const { eq, setEq } = props
  return (
    <div className="dj-eq-sliders">
      <label>
        Low
        <input type="range" min={-12} max={12} step={1} value={eq.low} onChange={(e) => setEq({ ...eq, low: Number(e.target.value) })} />
      </label>
      <label>
        Mid
        <input type="range" min={-12} max={12} step={1} value={eq.mid} onChange={(e) => setEq({ ...eq, mid: Number(e.target.value) })} />
      </label>
      <label>
        High
        <input type="range" min={-12} max={12} step={1} value={eq.high} onChange={(e) => setEq({ ...eq, high: Number(e.target.value) })} />
      </label>
    </div>
  )
}

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default App
