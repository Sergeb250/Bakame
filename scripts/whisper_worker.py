import argparse
import json
import os
import sys
import traceback

from whisper_runtime import WhisperRuntime


def send(payload):
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + '\n')
    sys.stdout.flush()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--prepare-model')
    parser.add_argument('--model-dir')
    args = parser.parse_args()
    runtime = WhisperRuntime()
    if args.prepare_model:
        info = runtime.ensure_model({'model': args.prepare_model, 'model_dir': args.model_dir, 'device': 'cpu'})
        send({'ok': True, 'warmed': True, **info})
        return

    send({'event': 'ready', 'pid': os.getpid(), **runtime.info})
    for raw_line in sys.stdin:
        if not raw_line.strip():
            continue
        request_id = None
        try:
            request = json.loads(raw_line)
            request_id = request.get('id')
            action = request.get('action')
            if action == 'transcribe':
                send({'id': request_id, 'ok': True, **runtime.transcribe(request)})
            elif action == 'warmup':
                send({'id': request_id, 'ok': True, 'warmed': True, **runtime.ensure_model(request)})
            elif action in ('unload', 'shutdown'):
                runtime.unload()
                send({'id': request_id, 'ok': True, 'unloaded': True})
                if action == 'shutdown':
                    break
            else:
                raise ValueError(f'Unsupported worker action: {action}')
        except Exception as error:
            send({'id': request_id, 'ok': False, 'error': str(error), 'traceback': traceback.format_exc()})


if __name__ == '__main__':
    main()
