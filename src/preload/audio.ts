// Audio-Umwandlung im Preload: WebM/Opus (MediaRecorder der WebView) → WAV
// 16 kHz Mono 16 Bit, bevor es den Hauptprozess erreicht. Web Audio dekodiert
// alles, was Chromium kennt; der Helfer liest dann nur `AVAudioFile`-Formate.

export const TARGET_SAMPLE_RATE = 16_000;

/** Mischt beliebig viele Kanäle auf einen (Mittelwert). */
export function mixToMono(buffer: AudioBuffer): Float32Array {
  const channels = buffer.numberOfChannels;
  const length = buffer.length;
  const out = new Float32Array(length);
  if (channels === 0) return out;
  for (let c = 0; c < channels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < length; i++) out[i] = (out[i] ?? 0) + (data[i] ?? 0);
  }
  if (channels > 1) {
    for (let i = 0; i < length; i++) out[i] = (out[i] ?? 0) / channels;
  }
  return out;
}

/** Float32-PCM (-1…1) → WAV-Datei (RIFF, PCM 16 Bit, Mono). */
export function encodeWav16(samples: Float32Array, sampleRate: number): Uint8Array {
  const dataBytes = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const writeAscii = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true); // PCM-Blockgröße
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // Byte-Rate
  view.setUint16(32, 2, true); // Block-Align
  view.setUint16(34, 16, true); // Bits je Sample
  writeAscii(36, "data");
  view.setUint32(40, dataBytes, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return new Uint8Array(buffer);
}

/**
 * Dekodiert und resampelt mit einem `OfflineAudioContext` auf 16 kHz:
 * `decodeAudioData` liefert Daten bereits in der Abtastrate des Kontexts.
 */
export async function decodeToWav16k(audio: ArrayBuffer): Promise<{ wav: Uint8Array; durationMs: number }> {
  const Ctx = globalThis.OfflineAudioContext;
  if (typeof Ctx !== "function") throw new Error("Web Audio ist in dieser Umgebung nicht verfügbar.");
  const ctx = new Ctx(1, 1, TARGET_SAMPLE_RATE);
  const decoded = await ctx.decodeAudioData(audio.slice(0));
  const mono = mixToMono(decoded);
  const wav = encodeWav16(mono, decoded.sampleRate);
  return { wav, durationMs: Math.round((mono.length / decoded.sampleRate) * 1000) };
}
