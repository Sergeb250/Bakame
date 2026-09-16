import os
import sys
import tempfile
import unittest
import wave
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from whisper_runtime import WhisperRuntime, load_audio_input


class WhisperRuntimeTests(unittest.TestCase):
    def test_pcm_wav_resampling_and_stereo_downmix(self):
        with tempfile.TemporaryDirectory(prefix='whisper-pcm-check-') as directory:
            filename = str(Path(directory) / 'sample.wav')
            samples = np.tile(np.array([16384, 0], dtype='<i2'), 4800)
            with wave.open(filename, 'wb') as output:
                output.setnchannels(2)
                output.setsampwidth(2)
                output.setframerate(48000)
                output.writeframes(samples.tobytes())
            audio = load_audio_input(filename)
            self.assertEqual(audio.dtype, np.float32)
            self.assertEqual(len(audio), 1600)
            np.testing.assert_allclose(audio, 0.25)

    def test_optimized_engine_uses_int8_reuses_model_and_consumes_segments(self):
        model = Mock()
        model.transcribe.return_value = (iter([SimpleNamespace(text=' The answer. ')]), SimpleNamespace(language='en'))
        factory = Mock(return_value=model)
        modules = {'ctranslate2': SimpleNamespace(get_cuda_device_count=lambda: 0),
                   'faster_whisper': SimpleNamespace(WhisperModel=factory)}
        with patch.dict(os.environ, {'WHISPER_ENGINE': 'faster', 'WHISPER_CPU_THREADS': '2'}), patch.dict(sys.modules, modules):
            runtime = WhisperRuntime()
            request = {'model': 'base', 'device': 'auto', 'audio_path': 'fixture.mp3', 'language': 'en'}
            runtime.ensure_model(request)
            result = runtime.transcribe(request)
            self.assertEqual(factory.call_count, 1)
            self.assertEqual(factory.call_args.kwargs['compute_type'], 'int8')
            self.assertEqual(factory.call_args.kwargs['device'], 'cpu')
            self.assertTrue(factory.call_args.kwargs['local_files_only'])
            self.assertEqual(model.transcribe.call_args.kwargs['beam_size'], 1)
            self.assertFalse(model.transcribe.call_args.kwargs['vad_filter'])
            self.assertEqual(result['text'], 'The answer.')
            self.assertEqual(result['engine'], 'faster')
            runtime.unload()
            self.assertIsNone(runtime.model)

    def test_uncached_optimized_model_can_be_downloaded_during_setup(self):
        factory = Mock(side_effect=[FileNotFoundError('not cached'), Mock()])
        modules = {'ctranslate2': SimpleNamespace(get_cuda_device_count=lambda: 0),
                   'faster_whisper': SimpleNamespace(WhisperModel=factory)}
        with patch.dict(os.environ, {'WHISPER_ENGINE': 'faster'}), patch.dict(sys.modules, modules):
            WhisperRuntime().ensure_model({'model': 'base'})
            self.assertEqual(factory.call_count, 2)
            self.assertFalse(factory.call_args.kwargs['local_files_only'])

    def test_original_engine_remains_available_with_cpu_fallback(self):
        model = Mock()
        model.transcribe.return_value = {'text': ' A question. ', 'language': 'en'}
        torch = SimpleNamespace(cuda=SimpleNamespace(is_available=lambda: False),
                                set_num_threads=Mock(), __version__='test')
        whisper = SimpleNamespace(load_model=Mock(return_value=model))
        with patch.dict(os.environ, {'WHISPER_ENGINE': 'openai', 'WHISPER_CPU_THREADS': 'invalid'}), \
                patch.dict(sys.modules, {'torch': torch, 'whisper': whisper}):
            runtime = WhisperRuntime()
            result = runtime.transcribe({'audio_path': 'fixture.mp3'})
            self.assertEqual(result['text'], 'A question.')
            self.assertEqual(result['engine'], 'openai')
            self.assertFalse(model.transcribe.call_args.kwargs['fp16'])
            torch.set_num_threads.assert_called_with(1)


if __name__ == '__main__':
    unittest.main()
