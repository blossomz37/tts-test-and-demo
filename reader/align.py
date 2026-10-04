"""Local authoring only. Reuses research/tools/align.py's pinned forced aligner.
Consumes generated inputs.json; never transcribes, synthesizes or uploads audio.
Requires a pre-existing, hash-verified base.en.pt. No implicit downloads.
"""
import argparse
import hashlib
import importlib.metadata
import json
import os
import re
from pathlib import Path
import socket
import subprocess
import time
import warnings


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def compact(text):
    return re.sub(r'\s', '', text)


def repair_collapsed_segments(model, result, chapter, whisper):
    """Retry only wholly collapsed segments within their proven synthesis window.
    Timings still come from the MP3 waveform, never interpolation between chunks.
    """
    collapsed = [s for s in result.segments if s.end <= s.start]
    words = [w for s in result.segments for w in s.words]
    output = [{'text': w.word, 'start': w.start, 'end': w.end} for w in words]
    if not collapsed:
        return output, [], []
    receipt = json.loads(Path(chapter['receiptPath']).read_text())
    if sha(chapter['receiptPath']) != chapter['receiptSha256']:
        raise RuntimeError('Receipt changed during alignment')
    targets = {id(w) for s in collapsed for w in s.words}
    encoded = chapter['narration'].encode('utf-16-le')
    cumulative, cursor = [], 0
    for w in words:
        cumulative.append((cursor, cursor + len(compact(w.word))))
        cursor = cumulative[-1][1]
    waveform = whisper.load_audio(chapter['audioPath'])
    timeline, repairs, messages, replacements = 0, [], [], []
    for chunk in receipt['chunks']:
        start = timeline
        end = start + chunk['samples'] / chunk['sample_rate']
        timeline = end + chunk['pause_seconds']
        before = encoded[:chunk['prepared_start'] * 2].decode('utf-16-le')
        text = encoded[chunk['prepared_start'] * 2:chunk['prepared_end'] * 2].decode('utf-16-le')
        lo = len(compact(before)); hi = lo + len(compact(text))
        indices = [i for i, (a, b) in enumerate(cumulative) if a >= lo and b <= hi]
        if not indices or not any(id(words[i]) in targets for i in indices):
            continue
        if compact(''.join(words[i].word for i in indices)) != compact(text):
            raise RuntimeError('Cannot map failed alignment to its recorded chunk')
        with warnings.catch_warnings(record=True) as captured:
            retry = model.align(waveform[round(start * 16000):round(end * 16000)], text, language='en', verbose=None)
        if retry is None:
            raise RuntimeError('Local alignment retry failed')
        new = [{'text': w.word, 'start': round(start + w.start, 6), 'end': round(start + w.end, 6)} for s in retry.segments for w in s.words]
        if compact(''.join(w['text'] for w in new)) != compact(text):
            raise RuntimeError('Local alignment retry changed text coverage')
        messages.extend(str(w.message) for w in captured)
        replacements.append((indices[0], indices[-1] + 1, new))
        repairs.append({'chunk': chunk['index'], 'audio_start': start, 'audio_end': end,
                        'text_sha256': chunk['text_sha256'], 'original_words': output[indices[0]:indices[-1] + 1],
                        'method': 'Forced alignment of decoded MP3 crop at recorded synthesis sample boundaries'})
    for lo, hi, new in reversed(replacements):
        output[lo:hi] = new
    if not replacements:
        messages.append('Collapsed segment could not be retried within a recorded chunk')
    return output, repairs, messages


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--inputs', required=True)
    parser.add_argument('--model', required=True, help='Existing cached base.en.pt')
    parser.add_argument('--chapter', type=int, help='Align only this chapter number')
    args = parser.parse_args()
    inputs_path = Path(args.inputs).resolve()
    data = json.loads(inputs_path.read_text())
    model_path = Path(args.model).expanduser().resolve()
    if not model_path.is_file() or model_path.name != 'base.en.pt':
        raise RuntimeError('Supply an existing cached base.en.pt; this tool never downloads models')
    os.environ['HF_HUB_OFFLINE'] = '1'
    os.environ['TRANSFORMERS_OFFLINE'] = '1'
    import stable_whisper
    import whisper
    import torch
    expected = whisper._MODELS['base.en'].split('/')[-2]
    if sha(model_path) != expected:
        raise RuntimeError('Whisper model checksum mismatch')
    versions = {name: importlib.metadata.version(name) for name in ['stable-ts', 'openai-whisper', 'torch', 'numpy']}
    if versions['stable-ts'] != '2.19.1' or versions['openai-whisper'] != '20250625':
        raise RuntimeError('Use stable-ts==2.19.1 and openai-whisper==20250625')
    def deny_network(*args, **kwargs):
        raise RuntimeError('Network disabled during alignment')
    socket.socket.connect = deny_network
    socket.create_connection = deny_network
    torch.set_num_threads(4)
    torch.manual_seed(0)
    model = stable_whisper.load_model('base.en', device='cpu', download_root=str(model_path.parent))
    provenance = {'method': 'stable-ts forced alignment', 'versions': versions,
                  'model': 'base.en', 'model_sha256': expected, 'device': 'cpu', 'threads': 4,
                  'language': 'en', 'seed': 0, 'regroup': True, 'script_sha256': sha(__file__),
                  'ffmpeg': subprocess.check_output(['ffmpeg', '-version'], text=True).splitlines()[0],
                  'notes': 'Machine estimates aligned to supplied text, not proof of narration completeness. No human timing review.'}
    out = inputs_path.parent / 'alignments'
    out.mkdir(exist_ok=True)
    for chapter in data['chapters']:
        if args.chapter and chapter['number'] != args.chapter:
            continue
        path = out / chapter['alignmentFile']
        identity = {'audio_sha256': chapter['audioSha256'], 'input_sha256': chapter['narrationSha256'], 'source_sha256': chapter['source']['sha256']}
        if sha(chapter['audioPath']) != identity['audio_sha256'] or sha(chapter['sourcePath']) != identity['source_sha256'] or sha(chapter['narrationPath']) != identity['input_sha256']:
            raise RuntimeError(f"Inputs changed: {chapter['id']}")
        if path.exists():
            saved = json.loads(path.read_text())
            if any(saved.get(k) != v for k, v in identity.items()):
                raise RuntimeError(f'Stale alignment: {path.name}')
            print(f"Retained {chapter['id']}", flush=True)
            continue
        started = time.monotonic()
        print(f"Aligning {chapter['id']} ({chapter['duration']:.1f} seconds)", flush=True)
        with warnings.catch_warnings(record=True) as captured:
            result = model.align(chapter['audioPath'], chapter['narration'], language='en', verbose=None)
        if result is None:
            raise RuntimeError(f"Alignment failed: {chapter['id']}")
        words, repairs, retry_messages = repair_collapsed_segments(model, result, chapter, whisper)
        nonword_cues = [w for w in words if not w['text'].strip()]
        words = [w for w in words if w['text'].strip()]
        initial_messages = [str(w.message) for w in captured]
        messages = retry_messages if repairs else initial_messages
        uncertain = [{'text': s.text, 'start': s.start, 'end': s.end} for s in result.segments if s.end <= s.start]
        record = {**provenance, **identity, 'warnings': messages, 'initial_warnings': initial_messages,
                  'initial_uncertain_segments': uncertain, 'repairs': repairs,
                  'nonword_cues': nonword_cues, 'seconds': round(time.monotonic() - started, 3), 'words': words}
        temporary = path.with_suffix('.tmp')
        temporary.write_text(json.dumps(record, ensure_ascii=False, indent=2) + '\n')
        temporary.replace(path)
        print(f"Aligned {chapter['id']}: {len(words)} word cues in {record['seconds']} seconds", flush=True)
        for message in messages:
            print(f"Warning {chapter['id']}: {message}", flush=True)


if __name__ == '__main__':
    main()
