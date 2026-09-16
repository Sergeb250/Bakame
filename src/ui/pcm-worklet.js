// AudioWorklet runs off the UI thread. Resample the actual audio-context rate
// to the 16 kHz mono PCM format expected by Whisper, including 44.1/48 kHz input.
class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 16000;
    this.weight = 0;
    this.sum = 0;
    this.samples = new Int16Array(1600);
    this.count = 0;
    this.energy = 0;
    this.port.onmessage = ({ data }) => {
      if (data?.type === 'flush') {
        if (this.weight) this._sample(this.sum / this.weight);
        this.weight = this.sum = 0;
        this._send();
        this.port.postMessage({ type: 'flushed' });
      }
    };
  }

  _sample(value) {
    const clipped = Math.max(-1, Math.min(1, value));
    this.samples[this.count++] = clipped < 0 ? clipped * 32768 : clipped * 32767;
    this.energy += clipped * clipped;
    if (this.count === this.samples.length) this._send();
  }

  _send() {
    if (!this.count) return;
    const buffer = this.samples.slice(0, this.count).buffer;
    this.port.postMessage({ type: 'audio', buffer, level: Math.sqrt(this.energy / this.count) }, [buffer]);
    this.count = 0;
    this.energy = 0;
  }

  process(inputs) {
    const channels = inputs[0];
    if (!channels?.length) return true;
    for (let i = 0; i < channels[0].length; i++) {
      let value = 0;
      for (const channel of channels) value += channel[i] || 0;
      value /= channels.length;
      let remaining = 1;
      while (remaining > 1e-8) {
        const taken = Math.min(remaining, this.ratio - this.weight);
        this.sum += value * taken;
        this.weight += taken;
        remaining -= taken;
        if (this.weight >= this.ratio - 1e-8) {
          this._sample(this.sum / this.weight);
          this.weight = this.sum = 0;
        }
      }
    }
    // Outputs remain silent: captured speech must never be played back.
    return true;
  }
}

registerProcessor('pcm-capture', PcmCaptureProcessor);
