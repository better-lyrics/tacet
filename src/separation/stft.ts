// Vendored from composer src/audio/separation/stft.ts @ 30f0e2e

const N_FFT = 4096;
const HOP_LENGTH = 1024;
const WIN_LENGTH = N_FFT;

const hannWindows = new Map<number, Float32Array>();

function hannWindow(size: number): Float32Array {
  const cached = hannWindows.get(size);
  if (cached) return cached;

  const w = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / size));
  }
  hannWindows.set(size, w);
  return w;
}

interface FftTables {
  cos: Float64Array;
  sin: Float64Array;
  reversed: Uint32Array;
}

const fftTablesByLength = new Map<number, FftTables>();

function bitReverse(value: number, bits: number): number {
  let reversed = 0;
  let v = value;
  for (let i = 0; i < bits; i++) {
    reversed = (reversed << 1) | (v & 1);
    v >>>= 1;
  }
  return reversed;
}

function fftTables(n: number): FftTables {
  const cached = fftTablesByLength.get(n);
  if (cached) return cached;

  const bits = Math.log2(n);
  if (!Number.isInteger(bits)) throw new Error("FFT length must be power of 2");

  const half = n / 2;
  const cos = new Float64Array(half);
  const sin = new Float64Array(half);
  for (let j = 0; j < half; j++) {
    const angle = (-2 * Math.PI * j) / n;
    cos[j] = Math.cos(angle);
    sin[j] = Math.sin(angle);
  }

  const reversed = new Uint32Array(n);
  for (let i = 0; i < n; i++) reversed[i] = bitReverse(i, bits);

  const tables: FftTables = { cos, sin, reversed };
  fftTablesByLength.set(n, tables);
  return tables;
}

function fftRadix2(real: Float32Array, imag: Float32Array): void {
  const n = real.length;
  const { cos, sin, reversed } = fftTables(n);

  for (let i = 0; i < n; i++) {
    const j = reversed[i];
    if (j > i) {
      const tmpReal = real[i];
      real[i] = real[j];
      real[j] = tmpReal;
      const tmpImag = imag[i];
      imag[i] = imag[j];
      imag[j] = tmpImag;
    }
  }

  for (let size = 2; size <= n; size *= 2) {
    const halfsize = size / 2;
    const stride = n / size;
    for (let i = 0; i < n; i += size) {
      for (let k = 0, twiddle = 0; k < halfsize; k++, twiddle += stride) {
        const wr = cos[twiddle];
        const wi = sin[twiddle];
        const idx = i + k;
        const jdx = idx + halfsize;
        const tr = wr * real[jdx] - wi * imag[jdx];
        const ti = wr * imag[jdx] + wi * real[jdx];
        real[jdx] = real[idx] - tr;
        imag[jdx] = imag[idx] - ti;
        real[idx] += tr;
        imag[idx] += ti;
      }
    }
  }
}

function ifftRadix2(real: Float32Array, imag: Float32Array): void {
  const n = real.length;
  for (let i = 0; i < n; i++) imag[i] = -imag[i];
  fftRadix2(real, imag);
  const invN = 1 / n;
  for (let i = 0; i < n; i++) {
    real[i] *= invN;
    imag[i] = -imag[i] * invN;
  }
}

interface Spectrogram {
  real: Float32Array;
  imag: Float32Array;
  numFrames: number;
  numBins: number;
}

function reflectPad(signal: Float32Array, padLeft: number, padRight: number): Float32Array {
  const out = new Float32Array(signal.length + padLeft + padRight);
  out.set(signal, padLeft);
  for (let i = 0; i < padLeft; i++) {
    const src = i + 1;
    out[padLeft - 1 - i] = signal[src < signal.length ? src : signal.length - 1];
  }
  for (let i = 0; i < padRight; i++) {
    const src = signal.length - 2 - i;
    out[padLeft + signal.length + i] = signal[src >= 0 ? src : 0];
  }
  return out;
}

interface StftOptions {
  center?: boolean;
  normalized?: boolean;
}

function stft(signal: Float32Array, opts: StftOptions = {}): Spectrogram {
  const { center = true, normalized = false } = opts;
  const window = hannWindow(WIN_LENGTH);

  const framed = center ? reflectPad(signal, WIN_LENGTH / 2, WIN_LENGTH / 2) : signal;
  const numFrames = 1 + Math.floor((framed.length - WIN_LENGTH) / HOP_LENGTH);
  const numBins = N_FFT / 2 + 1;
  const real = new Float32Array(numFrames * numBins);
  const imag = new Float32Array(numFrames * numBins);

  const frameReal = new Float32Array(N_FFT);
  const frameImag = new Float32Array(N_FFT);
  const scale = normalized ? 1 / Math.sqrt(N_FFT) : 1;

  for (let f = 0; f < numFrames; f++) {
    const start = f * HOP_LENGTH;
    for (let i = 0; i < WIN_LENGTH; i++) {
      frameReal[i] = framed[start + i] * window[i];
    }
    if (N_FFT > WIN_LENGTH) frameReal.fill(0, WIN_LENGTH);
    frameImag.fill(0);
    fftRadix2(frameReal, frameImag);
    for (let b = 0; b < numBins; b++) {
      real[f * numBins + b] = frameReal[b] * scale;
      imag[f * numBins + b] = frameImag[b] * scale;
    }
  }

  return { real, imag, numFrames, numBins };
}

interface IstftOptions {
  normalized?: boolean;
}

function istft(spec: Spectrogram, outputLength: number, opts: IstftOptions = {}): Float32Array {
  const { normalized = false } = opts;
  const window = hannWindow(WIN_LENGTH);
  const halfWin = WIN_LENGTH / 2;
  const paddedLength = outputLength + WIN_LENGTH;
  const out = new Float32Array(paddedLength);
  const norm = new Float32Array(paddedLength);

  const frameReal = new Float32Array(N_FFT);
  const frameImag = new Float32Array(N_FFT);
  const scale = normalized ? Math.sqrt(N_FFT) : 1;

  for (let f = 0; f < spec.numFrames; f++) {
    frameReal.fill(0);
    frameImag.fill(0);
    for (let b = 0; b < spec.numBins; b++) {
      frameReal[b] = spec.real[f * spec.numBins + b];
      frameImag[b] = spec.imag[f * spec.numBins + b];
    }
    for (let b = 1; b < spec.numBins - 1; b++) {
      frameReal[N_FFT - b] = frameReal[b];
      frameImag[N_FFT - b] = -frameImag[b];
    }
    ifftRadix2(frameReal, frameImag);
    const start = f * HOP_LENGTH;
    for (let i = 0; i < WIN_LENGTH; i++) {
      out[start + i] += frameReal[i] * scale * window[i];
      norm[start + i] += window[i] * window[i];
    }
  }

  const result = new Float32Array(outputLength);
  for (let i = 0; i < outputLength; i++) {
    const idx = i + halfWin;
    result[i] = norm[idx] > 1e-8 ? out[idx] / norm[idx] : 0;
  }
  return result;
}

export { N_FFT, HOP_LENGTH, reflectPad, stft, istft };
export type { Spectrogram };
