import * as Tone from 'tone'

export type DeckId = 'A' | 'B'

function pickMixRecorderMime(): string | undefined {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']
  for (const t of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) return t
  }
  return undefined
}

const CROSSFADER_CURVE = (t: number) => {
  const clamped = Math.max(0, Math.min(1, t))
  return {
    a: Math.cos(clamped * 0.5 * Math.PI),
    b: Math.sin(clamped * 0.5 * Math.PI),
  }
}

type DeckNodes = {
  player: Tone.Player | null
  eq: Tone.EQ3
  trim: Tone.Volume
  blobUrl: string | null
}

type DeckTransport = {
  playing: boolean
  anchorTime: number
  offset: number
}

export class DJEngine {
  private started = false
  private masterBus: Tone.Gain
  private masterVol: Tone.Volume
  private masterFilter: Tone.Filter
  private crossGainA: Tone.Gain
  private crossGainB: Tone.Gain

  readonly deckA: DeckNodes
  readonly deckB: DeckNodes
  private deckTransport: Record<DeckId, DeckTransport> = {
    A: { playing: false, anchorTime: 0, offset: 0 },
    B: { playing: false, anchorTime: 0, offset: 0 },
  }

  private drumBus: Tone.Volume
  private keysBus: Tone.Volume
  private bassBus: Tone.Volume
  private padBus: Tone.Volume
  /** Mic / recorder clips only (file drops on pads use {@link padBus}). */
  private voiceClipBus: Tone.Volume

  private kick: Tone.MembraneSynth
  private snare: Tone.NoiseSynth
  private hat: Tone.MetalSynth
  private clap: Tone.NoiseSynth
  private tom: Tone.MembraneSynth
  private perc: Tone.FMSynth

  readonly keys: Tone.PolySynth
  readonly bass: Tone.MonoSynth

  private seq: Tone.Sequence | null = null
  private seqPattern: boolean[][]
  private seqPlaying = false
  private seqBpm = 120

  private padPlayers: Map<number, Tone.Player> = new Map()
  private padBlobUrls: Map<number, string> = new Map()

  private mixRecordDest: MediaStreamAudioDestinationNode | null = null
  private mixRecorder: MediaRecorder | null = null
  private mixChunks: BlobPart[] = []

  constructor() {
    this.masterBus = new Tone.Gain(1)
    this.masterVol = new Tone.Volume(0)
    this.masterFilter = new Tone.Filter({
      type: 'lowpass',
      frequency: 12000,
      rolloff: -24,
      Q: 0.5,
    })
    this.masterBus.chain(this.masterFilter, this.masterVol, Tone.Destination)

    this.crossGainA = new Tone.Gain(1).connect(this.masterBus)
    this.crossGainB = new Tone.Gain(0).connect(this.masterBus)

    this.deckA = this.createDeckChain()
    this.deckB = this.createDeckChain()
    this.deckA.trim.connect(this.crossGainA)
    this.deckB.trim.connect(this.crossGainB)

    this.drumBus = new Tone.Volume(-6).connect(this.masterBus)
    this.keysBus = new Tone.Volume(-8).connect(this.masterBus)
    this.bassBus = new Tone.Volume(-6).connect(this.masterBus)
    this.padBus = new Tone.Volume(-3).connect(this.masterBus)
    this.voiceClipBus = new Tone.Volume(0).connect(this.masterBus)

    this.kick = new Tone.MembraneSynth({
      pitchDecay: 0.02,
      octaves: 6,
      oscillator: { type: 'sine' },
      envelope: { attack: 0.001, decay: 0.4, sustain: 0.01, release: 0.4 },
    }).connect(this.drumBus)

    this.snare = new Tone.NoiseSynth({
      noise: { type: 'white' },
      envelope: { attack: 0.001, decay: 0.15, sustain: 0, release: 0.05 },
    }).connect(this.drumBus)

    this.hat = new Tone.MetalSynth({
      envelope: { attack: 0.001, decay: 0.05, release: 0.01 },
      harmonicity: 5.1,
      modulationIndex: 32,
      resonance: 4000,
      octaves: 1.5,
    }).connect(this.drumBus)

    this.clap = new Tone.NoiseSynth({
      noise: { type: 'pink' },
      envelope: { attack: 0.002, decay: 0.2, sustain: 0, release: 0.1 },
    }).connect(this.drumBus)

    this.tom = new Tone.MembraneSynth({
      pitchDecay: 0.01,
      octaves: 2,
      envelope: { attack: 0.001, decay: 0.25, sustain: 0, release: 0.2 },
    }).connect(this.drumBus)

    this.perc = new Tone.FMSynth({
      harmonicity: 3,
      modulationIndex: 8,
      envelope: { attack: 0.001, decay: 0.1, sustain: 0, release: 0.1 },
    }).connect(this.drumBus)

    this.keys = new Tone.PolySynth({
      maxPolyphony: 8,
      voice: Tone.Synth,
      options: {
        oscillator: { type: 'triangle' },
        envelope: { attack: 0.02, decay: 0.2, sustain: 0.3, release: 0.4 },
      },
    }).connect(this.keysBus)
    this.keys.volume.value = -10

    this.bass = new Tone.MonoSynth({
      volume: -8,
      oscillator: { type: 'sawtooth' },
      filter: { Q: 2, type: 'lowpass', rolloff: -24 },
      envelope: { attack: 0.01, decay: 0.2, sustain: 0.4, release: 0.3 },
      filterEnvelope: {
        attack: 0.01,
        decay: 0.2,
        sustain: 0.2,
        release: 0.2,
        baseFrequency: 80,
        octaves: 2.5,
      },
    }).connect(this.bassBus)

    const rows = 8
    const steps = 16
    this.seqPattern = Array.from({ length: rows }, () => Array(steps).fill(false))
  }

  private createDeckChain(): DeckNodes {
    const eq = new Tone.EQ3({ low: 0, mid: 0, high: 0 })
    const trim = new Tone.Volume(0)
    eq.connect(trim)
    return { player: null, eq, trim, blobUrl: null }
  }

  async initialize(): Promise<void> {
    if (this.started) return
    await Tone.start()
    Tone.getTransport().bpm.value = this.seqBpm
    this.started = true
  }

  get isReady(): boolean {
    return this.started
  }

  setCrossfader(position01: number): void {
    const { a, b } = CROSSFADER_CURVE(position01)
    this.crossGainA.gain.rampTo(a, 0.02)
    this.crossGainB.gain.rampTo(b, 0.02)
  }

  setMasterDb(db: number): void {
    this.masterVol.volume.rampTo(db, 0.05)
  }

  setMasterFilterHz(hz: number): void {
    this.masterFilter.frequency.rampTo(hz, 0.05)
  }

  setDeckEq(deck: DeckId, low: number, mid: number, high: number): void {
    const d = deck === 'A' ? this.deckA : this.deckB
    d.eq.low.value = low
    d.eq.mid.value = mid
    d.eq.high.value = high
  }

  setDeckTrimDb(deck: DeckId, db: number): void {
    const d = deck === 'A' ? this.deckA : this.deckB
    d.trim.volume.rampTo(db, 0.05)
  }

  async loadDeckFile(deck: DeckId, file: File): Promise<void> {
    const nodes = deck === 'A' ? this.deckA : this.deckB
    if (nodes.player) {
      nodes.player.stop()
      nodes.player.disconnect()
      nodes.player.dispose()
      nodes.player = null
    }
    if (nodes.blobUrl) {
      URL.revokeObjectURL(nodes.blobUrl)
      nodes.blobUrl = null
    }
    this.deckTransport[deck] = { playing: false, anchorTime: 0, offset: 0 }
    const url = URL.createObjectURL(file)
    nodes.blobUrl = url
    const player = new Tone.Player({ url, loop: false, autostart: false })
    await player.load(url)
    player.connect(nodes.eq)
    nodes.player = player
  }

  deckPlay(deck: DeckId): void {
    const p = deck === 'A' ? this.deckA.player : this.deckB.player
    if (!p?.loaded) return
    const tr = this.deckTransport[deck]
    p.start(undefined, tr.offset)
    tr.playing = true
    tr.anchorTime = Tone.now()
  }

  deckPause(deck: DeckId): void {
    const p = deck === 'A' ? this.deckA.player : this.deckB.player
    if (!p?.loaded) return
    const tr = this.deckTransport[deck]
    if (!tr.playing) return
    tr.offset = this.getDeckPosition(deck)
    tr.playing = false
    p.stop()
  }

  deckStop(deck: DeckId): void {
    const p = deck === 'A' ? this.deckA.player : this.deckB.player
    const tr = this.deckTransport[deck]
    tr.offset = 0
    tr.playing = false
    p?.stop()
  }

  deckSeek(deck: DeckId, seconds: number): void {
    const p = deck === 'A' ? this.deckA.player : this.deckB.player
    if (!p?.loaded) return
    const dur = this.getDeckDuration(deck)
    const t = Math.max(0, Math.min(seconds, dur))
    const tr = this.deckTransport[deck]
    tr.offset = t
    if (tr.playing) {
      p.stop()
      p.start(undefined, t)
      tr.anchorTime = Tone.now()
    }
  }

  setDeckLoop(deck: DeckId, on: boolean): void {
    const p = deck === 'A' ? this.deckA.player : this.deckB.player
    if (p) p.loop = on
  }

  setDeckRate(deck: DeckId, rate: number): void {
    const p = deck === 'A' ? this.deckA.player : this.deckB.player
    if (p) p.playbackRate = rate
  }

  getDeckDuration(deck: DeckId): number {
    const p = deck === 'A' ? this.deckA.player : this.deckB.player
    return p?.buffer?.duration ?? 0
  }

  getDeckPosition(deck: DeckId): number {
    const p = deck === 'A' ? this.deckA.player : this.deckB.player
    const tr = this.deckTransport[deck]
    if (!p?.loaded) return 0
    const dur = this.getDeckDuration(deck)
    if (!tr.playing) return Math.min(tr.offset, dur)
    let pos = tr.offset + (Tone.now() - tr.anchorTime) * p.playbackRate
    if (p.loop && dur > 0) {
      pos = pos % dur
    } else {
      pos = Math.min(pos, dur)
    }
    return pos
  }

  triggerDrum(kind: 'kick' | 'snare' | 'hat' | 'clap' | 'tom' | 'perc', time?: number): void {
    const t = time ?? Tone.now()
    switch (kind) {
      case 'kick':
        this.kick.triggerAttackRelease('C1', '8n', t)
        break
      case 'snare':
        this.snare.triggerAttackRelease('8n', t)
        break
      case 'hat':
        this.hat.triggerAttackRelease('G5', '32n', t, 0.35)
        break
      case 'clap':
        this.clap.triggerAttackRelease('16n', t)
        break
      case 'tom':
        this.tom.triggerAttackRelease('G2', '8n', t)
        break
      case 'perc':
        this.perc.triggerAttackRelease('C4', '16n', t)
        break
    }
  }

  triggerKey(note: string, time?: number): void {
    this.keys.triggerAttackRelease(note, '8n', time ?? Tone.now())
  }

  triggerBass(note: string, time?: number): void {
    this.bass.triggerAttackRelease(note, '8n', time ?? Tone.now())
  }

  setInstrumentBus(which: 'drums' | 'keys' | 'bass' | 'pads' | 'voice', db: number): void {
    const bus = { drums: this.drumBus, keys: this.keysBus, bass: this.bassBus, pads: this.padBus, voice: this.voiceClipBus }[
      which
    ]
    bus.volume.rampTo(db, 0.05)
  }

  setVoiceClipGainDb(db: number): void {
    this.voiceClipBus.volume.rampTo(db, 0.05)
  }

  /** Load recorded mic clips onto a pad; routed through the voice clip bus (see {@link setVoiceClipGainDb}). */
  async loadPadBlob(slot: number, blob: Blob, filename = 'voice-clip'): Promise<void> {
    const ext =
      blob.type.includes('webm') ? 'webm' : blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'wav'
    const type = blob.type || 'audio/webm'
    const file = new File([blob], `${filename}.${ext}`, { type })
    await this.replacePadPlayer(slot, file, this.voiceClipBus)
  }

  async loadPadSample(slot: number, file: File): Promise<void> {
    await this.replacePadPlayer(slot, file, this.padBus)
  }

  private async replacePadPlayer(slot: number, file: File, bus: Tone.Volume): Promise<void> {
    const existing = this.padPlayers.get(slot)
    if (existing) {
      existing.dispose()
      this.padPlayers.delete(slot)
    }
    const oldUrl = this.padBlobUrls.get(slot)
    if (oldUrl) URL.revokeObjectURL(oldUrl)
    const url = URL.createObjectURL(file)
    this.padBlobUrls.set(slot, url)
    const player = new Tone.Player({ url, loop: false, autostart: false })
    await player.load(url)
    player.connect(bus)
    this.padPlayers.set(slot, player)
  }

  triggerPad(slot: number): void {
    const player = this.padPlayers.get(slot)
    if (player?.loaded) {
      player.stop()
      player.seek(0)
      player.start()
      return
    }
    const presets: Record<number, () => void> = {
      0: () => this.triggerDrum('kick'),
      1: () => this.triggerDrum('snare'),
      2: () => this.triggerDrum('hat'),
      3: () => this.triggerDrum('clap'),
      4: () => this.triggerDrum('tom'),
      5: () => this.triggerDrum('perc'),
      6: () => this.keys.triggerAttackRelease('E5', '32n'),
      7: () => this.bass.triggerAttackRelease('C2', '16n'),
    }
    presets[slot]?.()
  }

  setSequencerBpm(bpm: number): void {
    this.seqBpm = Math.max(60, Math.min(180, bpm))
    Tone.getTransport().bpm.value = this.seqBpm
  }

  getSequencerPattern(): boolean[][] {
    return this.seqPattern.map((row) => [...row])
  }

  toggleSequencerStep(row: number, step: number): void {
    if (this.seqPattern[row]?.[step] === undefined) return
    this.seqPattern[row][step] = !this.seqPattern[row][step]
  }

  /** Replace the full 8×16 grid (used when loading a saved set). */
  setSequencerPattern(next: boolean[][]): void {
    const rows = this.seqPattern.length
    const steps = this.seqPattern[0]?.length ?? 16
    for (let r = 0; r < rows; r++) {
      for (let s = 0; s < steps; s++) {
        this.seqPattern[r][s] = !!next[r]?.[s]
      }
    }
  }

  startSequencer(): void {
    if (this.seqPlaying) return
    const rows = this.seqPattern.length
    const sounds: ((time: number) => void)[] = [
      (time) => this.triggerDrum('kick', time),
      (time) => this.triggerDrum('snare', time),
      (time) => this.triggerDrum('hat', time),
      (time) => this.triggerDrum('clap', time),
      (time) => this.triggerDrum('tom', time),
      (time) => this.triggerDrum('perc', time),
      (time) => this.triggerKey('G4', time),
      (time) => this.triggerBass('D2', time),
    ]
    this.seq = new Tone.Sequence(
      (time, step) => {
        for (let r = 0; r < rows; r++) {
          if (this.seqPattern[r][step as number]) sounds[r]?.(time)
        }
      },
      [...Array(16).keys()],
      '16n',
    )
    this.seq.start(0)
    Tone.getTransport().start()
    this.seqPlaying = true
  }

  stopSequencer(): void {
    this.seq?.stop()
    this.seq?.dispose()
    this.seq = null
    Tone.getTransport().stop()
    Tone.getTransport().position = 0
    this.seqPlaying = false
  }

  get sequencerRunning(): boolean {
    return this.seqPlaying
  }

  /** True while the master bus is being captured to a file. */
  get isMixRecording(): boolean {
    return this.mixRecorder?.state === 'recording'
  }

  private ensureMixRecordDestination(): MediaStreamAudioDestinationNode {
    if (!this.mixRecordDest) {
      const raw = Tone.getContext().rawContext as AudioContext
      this.mixRecordDest = raw.createMediaStreamDestination()
      this.masterVol.connect(this.mixRecordDest)
    }
    return this.mixRecordDest
  }

  /**
   * Record everything that hits the master (decks, drums, pads, keys, bass, sequencer)
   * — same mix you hear after the master volume & filter.
   */
  startMixRecording(): void {
    if (!this.started) throw new Error('Audio context not started')
    if (typeof MediaRecorder === 'undefined') throw new Error('MediaRecorder not supported')
    if (this.mixRecorder?.state === 'recording') return

    const dest = this.ensureMixRecordDestination()
    this.mixChunks = []
    const mime = pickMixRecorderMime()
    const mr = mime ? new MediaRecorder(dest.stream, { mimeType: mime }) : new MediaRecorder(dest.stream)
    this.mixRecorder = mr
    mr.ondataavailable = (e) => {
      if (e.data.size > 0) this.mixChunks.push(e.data)
    }
    mr.start(250)
  }

  stopMixRecording(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      const mr = this.mixRecorder
      if (!mr || mr.state !== 'recording') {
        reject(new Error('Not recording'))
        return
      }
      mr.onstop = () => {
        const blob = new Blob(this.mixChunks, { type: mr.mimeType || 'audio/webm' })
        this.mixChunks = []
        this.mixRecorder = null
        resolve(blob)
      }
      mr.stop()
    })
  }

  dispose(): void {
    if (this.mixRecorder && this.mixRecorder.state !== 'inactive') {
      try {
        this.mixRecorder.stop()
      } catch {
        /* ignore */
      }
    }
    this.mixRecorder = null
    this.mixChunks = []
    if (this.mixRecordDest) {
      try {
        this.masterVol.disconnect(this.mixRecordDest)
      } catch {
        /* ignore */
      }
      this.mixRecordDest = null
    }

    this.stopSequencer()
    ;[this.deckA, this.deckB].forEach((d) => {
      if (d.player) {
        d.player.dispose()
        d.player = null
      }
      if (d.blobUrl) URL.revokeObjectURL(d.blobUrl)
      d.eq.dispose()
      d.trim.dispose()
    })
    this.padPlayers.forEach((pl) => pl.dispose())
    this.padPlayers.clear()
    this.padBlobUrls.forEach((u) => URL.revokeObjectURL(u))
    this.padBlobUrls.clear()
    this.kick.dispose()
    this.snare.dispose()
    this.hat.dispose()
    this.clap.dispose()
    this.tom.dispose()
    this.perc.dispose()
    this.keys.dispose()
    this.bass.dispose()
    this.crossGainA.dispose()
    this.crossGainB.dispose()
    this.drumBus.dispose()
    this.keysBus.dispose()
    this.bassBus.dispose()
    this.padBus.dispose()
    this.voiceClipBus.dispose()
    this.masterFilter.dispose()
    this.masterVol.dispose()
    this.masterBus.dispose()
  }
}
