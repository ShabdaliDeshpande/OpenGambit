// Game sounds, synthesised with the Web Audio API: no audio files are
// shipped. Browsers only allow sound after the user has interacted with the
// page, so the audio context is created on the first click or key press.

export type SoundKind = 'move' | 'capture' | 'check' | 'start' | 'end' | 'lowtime' | 'error';

const KEY = 'chess-app:sound';

let ctx: AudioContext | null = null;
let enabled = readEnabled();
const listeners = new Set<() => void>();

function readEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

export const soundOn = () => enabled;

export function setSoundOn(on: boolean): void {
  enabled = on;
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    // not saved: the choice lasts for this visit
  }
  for (const l of listeners) l();
}

export function onSoundSetting(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function audio(): AudioContext | null {
  if (typeof window === 'undefined' || !('AudioContext' in window)) return null;
  ctx ??= new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

if (typeof window !== 'undefined') {
  const unlock = () => {
    audio();
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
}

/** A short wooden knock: filtered noise plus a low thump. */
function knock(ac: AudioContext, at: number, gain: number, pitch: number) {
  const len = Math.floor(ac.sampleRate * 0.08);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 4);
  const noise = ac.createBufferSource();
  noise.buffer = buf;
  const band = ac.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = pitch * 6;
  band.Q.value = 1.2;
  const ng = ac.createGain();
  ng.gain.value = gain;
  noise.connect(band).connect(ng).connect(ac.destination);
  noise.start(at);

  const osc = ac.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(pitch, at);
  osc.frequency.exponentialRampToValueAtTime(pitch * 0.6, at + 0.08);
  const og = ac.createGain();
  og.gain.setValueAtTime(gain * 0.9, at);
  og.gain.exponentialRampToValueAtTime(0.001, at + 0.1);
  osc.connect(og).connect(ac.destination);
  osc.start(at);
  osc.stop(at + 0.12);
}

/** A soft bell tone. */
function tone(ac: AudioContext, at: number, freq: number, dur: number, gain: number) {
  const osc = ac.createOscillator();
  osc.type = 'triangle';
  osc.frequency.value = freq;
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(g).connect(ac.destination);
  osc.start(at);
  osc.stop(at + dur + 0.05);
}

export function playSound(kind: SoundKind): void {
  if (!enabled) return;
  const ac = audio();
  if (!ac || ac.state !== 'running') return;
  const t = ac.currentTime + 0.005;
  switch (kind) {
    case 'move':
      return knock(ac, t, 0.35, 190);
    case 'capture':
      knock(ac, t, 0.5, 150);
      return knock(ac, t + 0.045, 0.35, 230);
    case 'check':
      knock(ac, t, 0.4, 190);
      tone(ac, t + 0.02, 880, 0.18, 0.08);
      return;
    case 'start':
      tone(ac, t, 523, 0.25, 0.1);
      return tone(ac, t + 0.12, 784, 0.35, 0.1);
    case 'end':
      tone(ac, t, 784, 0.3, 0.1);
      tone(ac, t + 0.15, 659, 0.3, 0.1);
      return tone(ac, t + 0.3, 523, 0.5, 0.1);
    case 'lowtime':
      return tone(ac, t, 1320, 0.09, 0.07);
    case 'error':
      return tone(ac, t, 220, 0.15, 0.08);
  }
}
