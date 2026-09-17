"""Authoring only: stable-ts + Whisper base.en forced alignment. No API calls.
Run from any directory in an environment with stable-ts and ffmpeg installed.
Existing alignment files are retained. Runtime page needs none of these tools.
"""
from pathlib import Path
import json,hashlib,importlib.metadata
import stable_whisper,torch
ROOT=Path(__file__).resolve().parents[1]
torch.set_num_threads(4)
model=stable_whisper.load_model('base.en',device='cpu')
for folder in sorted((ROOT/'samples').iterdir()):
 if (folder/'alignment.json').exists():continue
 request=json.loads((folder/'request.json').read_text())
 audio=next(iter(folder.glob('audio.*')))
 print('Aligning',folder.name,flush=True)
 result=model.align(str(audio),request['input'],language='en',verbose=None)
 if result is None:raise RuntimeError('Alignment failed: '+folder.name)
 words=[{'text':w.word,'start':w.start,'end':w.end} for s in result.segments for w in s.words]
 record={'method':'stable-ts forced alignment','stable_ts_version':importlib.metadata.version('stable-ts'),'whisper_version':importlib.metadata.version('openai-whisper'),'model':'base.en','language':'en','audio_sha256':hashlib.sha256(audio.read_bytes()).hexdigest(),'input_sha256':hashlib.sha256(request['input'].encode()).hexdigest(),'notes':'Machine-aligned to supplied text; not human-verified and not evidence of transcription completeness.','words':words}
 (folder/'alignment.json').write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n')
 print('Aligned',len(words),'words',flush=True)
