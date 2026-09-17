"""Verify the bundled research evidence. No external dependencies or network."""
from pathlib import Path
from decimal import Decimal
import json,hashlib,wave
root=Path(__file__).resolve().parents[1]
def digest(b):return hashlib.sha256(b).hexdigest()
data=json.loads((root/'data.js').read_text().removeprefix('window.RESEARCH = ').rstrip(';\n'))
assert len(data['models'])==8
assert len(data['passage'])==285 and len(data['passage'].encode())==293
for m in data['models']:
 folder=root/m['evidence'];audio=root/m['audio'];request=folder/'request.json'
 r=json.loads((folder/'receipt.json').read_text());a=json.loads((folder/'alignment.json').read_text());q=json.loads(request.read_text())
 assert digest(request.read_bytes())==r['request_sha256']
 assert q['input']==data['passage'] and q['model']==m['requestedModel'] and q['voice']==m['voiceId']
 assert r['model']==m['receiptModel'] and r['id']==m['generationId'] and r['provider_name']==m['provider']
 assert r['total_cost']==m['cost'] and r['download_seconds']==m['downloadSeconds']
 assert m['words']==a['words'] and a['audio_sha256']==digest(audio.read_bytes()) and a['input_sha256']==digest(data['passage'].encode())
 if q['response_format']=='pcm':
  with wave.open(str(audio),'rb') as w:
   assert (w.getnchannels(),w.getsampwidth(),w.getframerate())==(1,2,24000)
   raw=w.readframes(w.getnframes())
 else:raw=audio.read_bytes()
 assert digest(raw)==r['raw_response_sha256']
 cursor=0;last=0
 for w in a['words']:
  word=w['text'].strip();start=data['passage'].find(word,cursor)
  assert start>=cursor and not data['passage'][cursor:start].strip(),(m['id'],w)
  cursor=start+len(word)
  assert 0<=w['start']<=w['end']<=m['duration'] and w['start']>=last,(m['id'],w)
  last=w['end']
 assert not data['passage'][cursor:].strip()
 for name in ['endpoints.json','ffprobe.json']:assert (folder/name).is_file()
assert sum(Decimal(str(m['cost'])) for m in data['models'])==Decimal('0.053303')
print('PASS: all 8 audio/request hashes, billing fields, exact text coverage, timing bounds/order and embedded timing parity; total $0.053303.')
