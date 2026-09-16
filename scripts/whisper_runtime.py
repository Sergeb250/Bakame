"""Local Whisper engines shared by model setup and the persistent live worker."""
import gc
import importlib.util
import os
import wave

import numpy as np


def cpu_threads(default):
    try:
        return max(1, min(8, int(os.environ.get('WHISPER_CPU_THREADS', default))))
    except ValueError:
        return default


def load_audio_input(audio_path):
    """Decode the app's PCM WAV without requiring a separate ffmpeg install."""
    if not str(audio_path).lower().endswith('.wav'):
        return audio_path
    try:
        with wave.open(audio_path, 'rb') as source:
            channels = source.getnchannels()
            width = source.getsampwidth()
            rate = source.getframerate()
            frames = source.readframes(source.getnframes())
        if width != 2:
            return audio_path
        samples = np.frombuffer(frames, dtype='<i2').astype(np.float32)
        if channels > 1:
            samples = samples.reshape(-1, channels).mean(axis=1)
        samples /= 32768.0
        if rate != 16000 and samples.size:
            count = max(1, round(samples.size * 16000 / rate))
            samples = np.interp(
                np.linspace(0, samples.size - 1, count), np.arange(samples.size), samples
            ).astype(np.float32)
        return samples
    except (OSError, EOFError, wave.Error, ValueError):
        return audio_path


class WhisperRuntime:
    def __init__(self):
        requested = os.environ.get('WHISPER_ENGINE', 'auto').strip().lower()
        if requested not in ('auto', 'openai', 'faster'):
            raise ValueError('WHISPER_ENGINE must be auto, faster, or openai')
        self.engine = ('faster' if importlib.util.find_spec('faster_whisper') else 'openai') if requested == 'auto' else requested
        self.model = None
        self.key = None
        self.torch = None
        self.info = {'engine': self.engine, 'gpu': None}

    def unload(self):
        self.model = None
        self.key = None
        gc.collect()
        if self.torch is not None and self.torch.cuda.is_available():
            self.torch.cuda.empty_cache()

    def ensure_model(self, request):
        name = request.get('model') or 'base'
        directory = request.get('model_dir') or None
        device = request.get('device') or 'auto'
        if self.engine == 'faster':
            import ctranslate2
            from faster_whisper import WhisperModel
            cuda_available = ctranslate2.get_cuda_device_count() > 0
        else:
            import torch
            import whisper
            self.torch = torch
            torch.set_num_threads(cpu_threads(1))
            cuda_available = torch.cuda.is_available()
        if device == 'auto':
            device = 'cuda' if cuda_available else 'cpu'
        if device == 'cuda' and not cuda_available:
            raise RuntimeError('CUDA is unavailable in this Whisper runtime. Choose CPU in Settings.')
        key = (name, directory, device)
        if self.model is None or self.key != key:
            self.unload()
            if self.engine == 'faster':
                options = dict(device=device, compute_type='int8' if device == 'cpu' else 'float16',
                               cpu_threads=cpu_threads(2), num_workers=1, download_root=directory)
                # Once installed, listening also works offline and does not wait
                # for a remote metadata check each time the model is loaded.
                try:
                    self.model = WhisperModel(name, local_files_only=True, **options)
                except (OSError, RuntimeError):
                    self.model = WhisperModel(name, local_files_only=False, **options)
            else:
                self.model = whisper.load_model(name, device=device, download_root=directory)
            self.key = key
        self.info.update(model=name, device=device, cuda_available=cuda_available, model_dir=directory)
        if self.torch is not None:
            self.info['torch'] = self.torch.__version__
            self.info['gpu'] = self.torch.cuda.get_device_name(0) if cuda_available else None
        return self.info

    def transcribe(self, request):
        self.ensure_model(request)
        language = request.get('language') or None
        if language in ('auto', 'detect'):
            language = None
        audio = load_audio_input(request['audio_path'])
        if self.engine == 'faster':
            segments, info = self.model.transcribe(
                audio, language=language, task='transcribe', beam_size=1, best_of=1,
                temperature=0, condition_on_previous_text=False, vad_filter=False,
            )
            text = ' '.join(segment.text.strip() for segment in segments).strip()
            detected_language = info.language
        else:
            result = self.model.transcribe(
                audio, language=language, task='transcribe', fp16=self.info['device'] == 'cuda',
                verbose=None, temperature=0, condition_on_previous_text=False,
            )
            text = (result.get('text') or '').strip()
            detected_language = result.get('language')
        return {**self.info, 'text': text, 'language': detected_language}
