const { EventEmitter } = require('events');

// Serialize Whisper inference without letting new audio change a queued utterance.
// Final utterances take priority; only the latest unfinished preview is retained.
class TranscriptionQueue extends EventEmitter {
  constructor(transcribe) {
    super();
    this.transcribe = transcribe;
    this.finals = [];
    this.preview = null;
    this.running = null;
    this.pendingBytes = 0;
    this.finalizedThrough = 0;
    this.previewsEnabled = true;
  }

  enqueue(buffer, id) {
    this.finalizedThrough = Math.max(this.finalizedThrough, id);
    if (this.preview?.id <= id) this.preview = null;
    if (!buffer.length) return;
    this.finals.push({ buffer: Buffer.from(buffer), id, final: true });
    this.pendingBytes += buffer.length;
    this._kick();
    this.emit('backlog', this.pendingBytes / 32);
  }

  previewLatest(buffer, id) {
    if (!this.previewsEnabled || id <= this.finalizedThrough || this.finals.length) return;
    this.preview = { buffer: Buffer.from(buffer), id, final: false };
    this._kick();
  }

  _kick() {
    if (this.running) return;
    this.running = Promise.resolve().then(async () => {
      while (this.finals.length || this.preview) {
        const job = this.finals.shift() || this.preview;
        if (job === this.preview) this.preview = null;
        try {
          const text = await this.transcribe(job.buffer, { preview: !job.final });
          if (job.final) this.emit('transcription', text, { utteranceId: job.id });
          else if (this.previewsEnabled && job.id > this.finalizedThrough) {
            this.emit('partial', text, { utteranceId: job.id });
          }
        } catch (error) {
          this.emit('failure', error, { preview: !job.final, utteranceId: job.id });
        } finally {
          if (job.final) {
            this.pendingBytes -= job.buffer.length;
            this.emit('backlog', this.pendingBytes / 32);
          }
        }
      }
    }).finally(() => {
      this.running = null;
      if (this.finals.length || this.preview) this._kick();
    });
  }

  async drain() {
    this.previewsEnabled = false;
    this.preview = null;
    while (this.running) await this.running;
  }
}

module.exports = TranscriptionQueue;
