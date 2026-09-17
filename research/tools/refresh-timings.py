"""Refresh embedded timing data only. No network or inference."""
from pathlib import Path
import json
root=Path(__file__).resolve().parents[1];p=root/'data.js'
s=p.read_text();data=json.loads(s.removeprefix('window.RESEARCH = ').rstrip(';\n'))
for m in data['models']:
 m['words']=json.loads((root/m['evidence']/'alignment.json').read_text())['words']
p.write_text('window.RESEARCH = '+json.dumps(data,ensure_ascii=False,indent=2)+';\n')
print('Updated embedded timings for',len(data['models']),'samples.')
