// Disposable synthetic browser fixture. Timings describe test tones, not speech alignment.
import { mkdtemp, realpath, mkdir, writeFile, readFile, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { inspectInputs, hash } from '../reader/inputs.mjs';
const root=await mkdtemp(resolve(await realpath(tmpdir()),'reader-verification-'));
const long = process.argv.includes('--long');
const chapters=resolve(root,'chapters'), run=resolve(root,'run');
for(const dir of [chapters,...['mp3','prepared','receipts','reader/alignments'].map(p=>resolve(run,p))])await mkdir(dir,{recursive:true});
execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','sine=frequency=220:duration=15','-codec:a','libmp3lame',resolve(run,'mp3/chapter-01.mp3')]);
const inputs=[];
for(let n=1;n<=2;n++){
 const id=`chapter-0${n}`,file=`ch${n}_Final_v1.md`,text=`The quiet street.\n\nA second passage for chapter ${n}.` + (long ? '\n\n' + Array.from({length:32},(_,i)=>`Paragraph ${i+3}. The novelist followed the quiet street past the old library. A feather 🪶 caught the light.\nThis soft line belongs to the same paragraph, with enough text to wrap as the reading width changes.`).join('\n\n') : '');
 if(n===2)await copyFile(resolve(run,'mp3/chapter-01.mp3'),resolve(run,`mp3/${id}.mp3`));
 const audio=await readFile(resolve(run,`mp3/${id}.mp3`)),sha=hash(text);
 await writeFile(resolve(chapters,file),text);await writeFile(resolve(run,`prepared/${id}.txt`),text);
 inputs.push({file,chapter:n,sha256:sha,prepared_sha256:sha,exclusions:[]});
 await writeFile(resolve(run,`receipts/${id}.json`),JSON.stringify({status:'complete',chapter:n,source_sha256:sha,prepared_sha256:sha,exclusions:[],duration_seconds:15.05,mp3:{file:`mp3/${id}.mp3`,sha256:hash(audio)}}));
}
await writeFile(resolve(run,'render-config.json'),JSON.stringify({inputs}));
const data=await inspectInputs({chapters,audioRun:run,bookId:'reader-verification',title:'Reader verification'});
for(const c of data.chapters){
 const matches=[...c.source.text.matchAll(/\S+/g)],step=long?14/matches.length:1.3;
 const words=matches.map((m,i)=>({text:(i?' ':'')+m[0],start:i*step,end:i*step+step*.8}));
 await writeFile(resolve(run,'reader/alignments',c.alignmentFile),JSON.stringify({source_sha256:c.source.sha256,audio_sha256:c.audioSha256,input_sha256:c.narrationSha256,words}));
}
execFileSync(process.execPath,[fileURLToPath(new URL('../reader/generate.mjs',import.meta.url)),'--chapters',chapters,'--audio-run',run,'--book-id','reader-verification','--title','Reader verification'],{stdio:'inherit'});
console.log(`Fixture launcher: ${resolve(run,'reader/serve.mjs')} --port 0`);
