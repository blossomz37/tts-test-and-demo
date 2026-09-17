/* Standalone, file://-compatible player. No fetch, inference, storage or service worker. */
(() => {
'use strict';
const data = window.RESEARCH;
const $ = id => document.getElementById(id);
const audio = $('audio'), play = $('play'), seek = $('seek'), status = $('status');
const icons = {play:'<path d="m8 5 11 7-11 7Z"/>',pause:'<path d="M8 5v14M16 5v14"/>',restart:'<path d="M3 10a9 9 0 1 1 2.6 8.4M3 4v6h6"/>',download:'<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',open:'<path d="M14 3h7v7m0-7L10 14M10 3H3v18h18v-7"/>'};
function icon(el, type, label) {
 el.innerHTML = `<svg aria-hidden="true" viewBox="0 0 24 24">${icons[type]}</svg>`;
 el.setAttribute('aria-label', label); el.dataset.tooltip = label;
 if (tooltipOwner === el) showTooltip(el);
}
const money = amount => amount === 0 ? 'Free' : '$' + amount.toFixed(6).replace(/0+$/, '');
const time = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2,'0')}`;
const reported = value => value === null || value === undefined ? 'Not reported' : String(value);
let selected = data.models[0], spans = [], raf = 0, epoch = 0, tooltipOwner = null, tooltipTimer;
const tooltip = $('tooltip');
function hideTooltip() { clearTimeout(tooltipTimer); tooltip.hidden = true; tooltipOwner = null; }
function showTooltip(el) {
 clearTimeout(tooltipTimer); tooltipOwner = el; tooltip.textContent = el.dataset.tooltip; tooltip.hidden = false;
 const r = el.getBoundingClientRect(), b = tooltip.getBoundingClientRect();
 tooltip.style.left = `${Math.max(8, Math.min(innerWidth - b.width - 8, r.left + (r.width-b.width)/2))}px`;
 tooltip.style.top = `${r.bottom + b.height + 8 < innerHeight ? r.bottom+6 : Math.max(8,r.top-b.height-6)}px`;
}
document.addEventListener('pointerover', e => { const el = e.target.closest('[data-tooltip]'); if(el) showTooltip(el); else if(e.target===tooltip) clearTimeout(tooltipTimer); });
document.addEventListener('pointerout', e => { if(tooltipOwner && e.relatedTarget!==tooltip && !tooltipOwner.contains(e.relatedTarget) && document.activeElement!==tooltipOwner) tooltipTimer=setTimeout(hideTooltip,100); });
document.addEventListener('focusin', e => { if(e.target.matches('[data-tooltip]')) showTooltip(e.target); });
document.addEventListener('focusout', hideTooltip);
document.addEventListener('keydown', e => { if(e.key==='Escape') hideTooltip(); });
window.addEventListener('resize',hideTooltip); document.addEventListener('scroll',hideTooltip,true);
function message(text, error=false) { status.textContent=text; status.classList.toggle('error',error); }
function renderPassage() {
 // Keep the author's exact text and whitespace; cues are mapped to character ranges.
 const source = data.passage;
 let cursor = 0; spans=[]; $('passage').replaceChildren();
 for(const [cueIndex, cue] of selected.words.entries()) {
  const word = cue.text.trim(); if(!word) continue;
  const start = source.indexOf(word,cursor);
  if(start < 0) { $('passage').textContent=source; spans=[]; message('This sample has no matching word alignment.',true);return; }
  $('passage').append(document.createTextNode(source.slice(cursor,start)));
  const span = document.createElement('span');span.className='word';span.textContent=word;
  $('passage').append(span);// A collapsed short word shares the next timed word rather than disappearing.
  const next = selected.words.slice(cueIndex+1).find(w => w.end>cue.start);
  spans.push({span,start:cue.start,end:cue.end>cue.start?cue.end:(next?.end ?? cue.end)});cursor=start+word.length;
 }
 $('passage').append(document.createTextNode(source.slice(cursor)));
}
function update() {
 const t = audio.currentTime || 0, duration = Number.isFinite(audio.duration) ? audio.duration : selected.duration;
 seek.max=duration;seek.value=t;seek.setAttribute('aria-valuetext',`${time(t)} of ${time(duration)}`);
 $('elapsed').textContent=time(t);$('duration').textContent=time(duration);
 for(const cue of spans) {
  cue.span.classList.toggle('current',!audio.ended && t>=cue.start && t<cue.end);
  cue.span.classList.toggle('said',t>=cue.end && t>0);
 }
}
function frame() { update(); if(!audio.paused && !audio.ended) raf=requestAnimationFrame(frame); }
function syncButtons() {
 const active = !audio.paused && !audio.ended;
 icon(play,active?'pause':'play',active?'Pause':'Play');
 for(const model of data.models) {
  const row=$('row-'+model.id), button=row.querySelector('.sample-play');
  row.classList.toggle('selected',model.id===selected.id);
  row.querySelector('.model-select').setAttribute('aria-pressed',String(model.id===selected.id));
  icon(button,active&&model.id===selected.id?'pause':'play',`${active&&model.id===selected.id?'Pause':'Play'} ${model.name}`);
 }
}
function renderDetails() {
 const m=selected;
 const fields=[['Requested model',m.requestedModel],['Receipt model',m.receiptModel],['Voice ID',m.voiceId],['Routed provider',m.provider],['Generation ID',m.generationId],['Billed cost',money(m.cost)+' USD'],['Full audio ready',m.downloadSeconds.toFixed(3)+' s'],['First byte / generation time','See receipt / '+reported(m.generationTime)],['Receipt latency',reported(m.latency)+' (raw API value)'],['Audio duration',m.duration.toFixed(3)+' s'],['Prompt tokens',reported(m.promptTokens)],['Native input / output tokens',reported(m.nativePrompt)+' / '+reported(m.nativeCompletion)]];
 $('details').replaceChildren();
 for(const [name,value] of fields) { const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=name;dd.textContent=value;$('details').append(dt,dd); }
 $('evidence-links').replaceChildren();
 for(const [file,label] of [['request.json','Exact request'],['receipt.json','Billing receipt'],['endpoints.json','Price snapshot'],['alignment.json','Word timings']]) {
  const a=document.createElement('a');a.href=`${m.evidence}/${file}`;a.textContent=label;a.target='_blank';a.rel='noopener';$('evidence-links').append(a);
 }
}
function select(model) {
 epoch++;cancelAnimationFrame(raf);audio.pause();selected=model;
 audio.src=model.audio;audio.load();audio.playbackRate=Number($('speed').value);
 $('model-name').textContent=model.name;$('voice-label').textContent=`${model.voice} · ${model.provider}`;$('sample-cost').textContent=money(model.cost);
 $('download').href=model.audio;$('download').download=model.id+model.audio.slice(model.audio.lastIndexOf('.'));
 message('Ready to play.');renderPassage();renderDetails();update();syncButtons();
}
async function toggle() {
 if(!audio.paused){audio.pause();return;}
 const callEpoch=epoch;
 if(audio.ended) audio.currentTime=0;
 message('Loading audio…');
 try {await audio.play();if(callEpoch!==epoch)return;}
 catch(error) {if(callEpoch!==epoch)return;message('Could not play this file. Try Play again or use the audio link.',true);syncButtons();}
}
for(const model of data.models) {
 const row=document.createElement('tr');row.id='row-'+model.id;
 const cell=document.createElement('td'),choose=document.createElement('button'),voice=document.createElement('span');
 choose.className='model-select';choose.textContent=model.name;choose.setAttribute('aria-label',`Select ${model.name}`);choose.addEventListener('click',()=>{select(model);$('player').scrollIntoView({block:'start'});});
 voice.className='model-voice';voice.textContent=model.voice;cell.append(choose,voice);row.append(cell);
 for(const text of [model.provider,money(model.cost),model.downloadSeconds.toFixed(3)+' s']){const td=document.createElement('td');td.textContent=text;row.append(td);}
 const actions=document.createElement('td'),wrap=document.createElement('div'),button=document.createElement('button'),link=document.createElement('a');wrap.className='row-actions';button.className='icon sample-play';
 button.addEventListener('click',()=>{if(selected.id!==model.id)select(model);toggle();$('player').scrollIntoView({block:'start'});});
 link.className='icon';link.href=model.audio;link.target='_blank';link.rel='noopener';link.addEventListener('click',()=>audio.pause());icon(link,'open',`Open ${model.name} audio`);
 wrap.append(button,link);actions.append(wrap);row.append(actions);$('models').append(row);
}
icon($('restart'),'restart','Start over');icon($('download'),'download','Download audio');
play.addEventListener('click',toggle);
$('restart').addEventListener('click',()=>{audio.currentTime=0;update();if(audio.paused)message('Ready to play.');});
seek.addEventListener('input',()=>{audio.currentTime=Number(seek.value);update();});
$('speed').addEventListener('change',()=>{audio.playbackRate=Number($('speed').value);});
audio.addEventListener('playing',()=>{message('Playing.');cancelAnimationFrame(raf);syncButtons();frame();});
audio.addEventListener('pause',()=>{cancelAnimationFrame(raf);syncButtons();update();if(!audio.ended)message('Paused.');});
audio.addEventListener('ended',()=>{cancelAnimationFrame(raf);syncButtons();update();message('Finished.');});
audio.addEventListener('error',()=>{cancelAnimationFrame(raf);syncButtons();message('Audio unavailable. Use the file link or check the samples folder.',true);});
for(const event of ['timeupdate','seeked','loadedmetadata','durationchange'])audio.addEventListener(event,update);
select(selected);
})();
