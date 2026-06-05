// Lightweight execution feedback sound (no asset files needed). Uses the Web
// Audio API to synthesize a short two-tone "order filled" chime, similar in
// spirit to a desktop trading terminal's execution confirmation.

let ctx: AudioContext | null = null

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null
  try {
    if (!ctx) {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      ctx = new Ctor()
    }
    // Browsers suspend the context until a user gesture; resume on demand.
    if (ctx.state === "suspended") void ctx.resume()
    return ctx
  } catch {
    return null
  }
}

/** Play a short confirmation chime. `tone` shifts pitch for buy vs sell. */
export function playExecutionSound(tone: "buy" | "sell" = "buy"): void {
  const audio = getCtx()
  if (!audio) return

  const now = audio.currentTime
  // Buy = rising major third, Sell = falling — a subtle directional cue.
  const notes = tone === "buy" ? [660, 880] : [660, 494]

  notes.forEach((freq, i) => {
    const osc = audio.createOscillator()
    const gain = audio.createGain()
    osc.type = "sine"
    osc.frequency.value = freq

    const start = now + i * 0.09
    const end = start + 0.12
    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.exponentialRampToValueAtTime(0.18, start + 0.015)
    gain.gain.exponentialRampToValueAtTime(0.0001, end)

    osc.connect(gain)
    gain.connect(audio.destination)
    osc.start(start)
    osc.stop(end + 0.02)
  })
}
