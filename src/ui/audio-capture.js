class LiveAudioCapture {
  constructor({ onAudio, onError, mediaDevices = navigator.mediaDevices }) {
    this.onAudio = onAudio;
    this.onError = onError;
    this.mediaDevices = mediaDevices;
    this.generation = 0;
    this.resources = null;
  }

  async start(config) {
    const generation = ++this.generation;
    const previous = this.resources;
    const resources = { streams: [], nodes: [], context: null, processor: null };
    this.resources = resources;
    await this._release(previous);
    const current = () => generation === this.generation;
    const acquire = async promise => {
      const stream = await promise;
      if (!current()) {
        stream.getTracks().forEach(track => track.stop());
        return null;
      }
      resources.streams.push(stream);
      if (!stream.getAudioTracks().length) throw new Error('No audio track was provided by the selected source.');
      for (const track of stream.getAudioTracks()) {
        track.onended = () => {
          if (current()) {
            this.stop().finally(() => this.onError('The audio source disconnected. Select a source and start listening again.', config.captureId));
          }
        };
      }
      return stream;
    };
    try {
      if (!current()) return false;
      if (config.audioSource !== 'microphone') {
        if (!config.systemAudioSupported) throw new Error('System audio capture is supported on Windows. Use microphone input on this platform.');
        // Electron supplies Windows loopback through the display-media handler.
        // The video track is required by Chromium but is never rendered or sent.
        const system = await acquire(this.mediaDevices.getDisplayMedia({
          audio: true, video: { width: 16, height: 16, frameRate: 1 }
        }));
        if (!system) return false;
        system.getVideoTracks().forEach(track => { track.enabled = false; });
      }
      if (config.audioSource !== 'system') {
        if (!await acquire(this.mediaDevices.getUserMedia({ audio: {
          echoCancellation: true, noiseSuppression: true, autoGainControl: true,
          sampleRate: { ideal: 16000 }
        } }))) return false;
      }
      if (!current()) return false;
      const context = new AudioContext({ sampleRate: 16000 });
      resources.context = context;
      await context.audioWorklet.addModule(new URL('./pcm-worklet.js', document.currentScript?.src || new URL('src/ui/audio-capture.js', document.baseURI)));
      if (!current()) return false;
      const processor = new AudioWorkletNode(context, 'pcm-capture', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      resources.processor = processor;
      processor.port.onmessage = ({ data }) => {
        if (data.type === 'flushed') resources.onFlushed?.();
        if (data.type === 'audio' && (current() || resources.flushing)) {
          this.onAudio(data.buffer, data.level, config.captureId);
        }
      };
      for (const stream of resources.streams) {
        const audioOnly = new MediaStream(stream.getAudioTracks());
        const source = context.createMediaStreamSource(audioOnly);
        const gain = context.createGain();
        gain.gain.value = resources.streams.length > 1 ? 0.7 : 1;
        source.connect(gain).connect(processor);
        resources.nodes.push(source, gain);
      }
      processor.connect(context.destination);
      await context.resume();
      return current();
    } catch (error) {
      if (current()) {
        await this.stop();
        this.onError(`Could not start audio capture: ${error.message}`, config.captureId);
      }
      return false;
    } finally {
      if (!current()) await this._release(resources);
    }
  }

  async stop() {
    ++this.generation;
    const resources = this.resources;
    this.resources = null;
    if (resources?.processor) {
      resources.flushing = true;
      await new Promise(resolve => {
        const timer = setTimeout(resolve, 500);
        resources.onFlushed = () => { clearTimeout(timer); resolve(); };
        resources.processor.port.postMessage({ type: 'flush' });
      });
      resources.flushing = false;
    }
    await this._release(resources);
  }

  async _release(resources) {
    if (!resources) return;
    for (const stream of resources.streams) {
      stream.getTracks().forEach(track => { track.onended = null; track.stop(); });
    }
    resources.nodes.forEach(node => { try { node.disconnect(); } catch (_) {} });
    try { resources.processor?.disconnect(); } catch (_) {}
    if (resources.context && resources.context.state !== 'closed') {
      await resources.context.close().catch(() => {});
    }
  }
}

window.LiveAudioCapture = LiveAudioCapture;
