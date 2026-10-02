/**
 * Small synthesised sound effects (no audio files to download). The audio
 * context is created lazily on the first user gesture, as browsers require.
 */
type SoundName = 'pickup' | 'snap' | 'place' | 'complete' | 'join' | 'notice';

class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  enabled = true;
  volume = 0.6;

  private ensure(): AudioContext | null {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      try {
        this.ctx = new Ctor();
      } catch {
        return null;
      }
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      const len = Math.floor(this.ctx.sampleRate * 0.25);
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);
    return this.ctx;
  }

  /** Call from a user gesture so later sounds are allowed to play. */
  unlock(): void {
    if (this.enabled) this.ensure();
  }

  play(name: SoundName): void {
    if (!this.enabled || this.volume <= 0) return;
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    this.master.gain.value = this.volume * 0.9;
    const t = ctx.currentTime + 0.005;
    switch (name) {
      case 'pickup':
        this.click(t, 2400, 0.035, 0.12);
        break;
      case 'snap':
        this.click(t, 1500, 0.05, 0.42);
        this.tone(t, 660, 0.07, 0.05, 'sine');
        break;
      case 'place':
        this.click(t, 900, 0.07, 0.5);
        this.tone(t, 392, 0.12, 0.08, 'sine');
        break;
      case 'complete':
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.tone(t + i * 0.11, f, 0.7, 0.11, 'triangle'));
        break;
      case 'join':
        this.tone(t, 880, 0.12, 0.05, 'sine');
        this.tone(t + 0.08, 1174.66, 0.16, 0.05, 'sine');
        break;
      case 'notice':
        this.tone(t, 440, 0.1, 0.05, 'sine');
        break;
    }
  }

  /** A short filtered noise burst: sounds like cardboard pieces touching. */
  private click(t: number, freq: number, dur: number, gain: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = freq;
    filter.Q.value = 1.4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(g).connect(this.master!);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  private tone(t: number, freq: number, dur: number, gain: number, type: OscillatorType) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.master!);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }
}

export const sound = new SoundEngine();
