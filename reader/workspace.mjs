import { SidecarStore, sidecarKey } from './state.mjs';
import { preferencesKey, selectedKey, reviewKey, identity, validateBackup, markdownBrief, summary } from './book-records.mjs';
import { readingPreferences } from './reading-state.mjs';
const $ = id => document.getElementById(id);
export function downloadFile(value, name, type = 'application/json') {
  const text = type === 'application/json' ? JSON.stringify(value, null, 2) + '\n' : value;
  const url = URL.createObjectURL(new Blob([text], { type })), a = document.createElement('a');
  a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 2000);
}
export function mountWorkspace({ data, storage, browserStorage, context, navigate, listen, locate, showNotes, update, pause, refresh }) {
  const message = text => { $('action-status').textContent = text; };
  const records = () => Object.fromEntries(data.chapters.flatMap(c => [sidecarKey(data.bookId, c.id), reviewKey(data.bookId, c)]).concat(Object.keys(storage.records || {})).filter((v,i,a)=>a.indexOf(v)===i).map(k=>[k,storage.getItem(k)]).filter(([,v])=>v!==null));
  const run = action => async () => { try { await action(); } catch (e) { message(e.message); } };
  const flush = () => storage.flush?.() || Promise.resolve();
  const loadPreferences = () => readingPreferences(JSON.parse(storage.getItem(preferencesKey(data.bookId)) || '{}'), globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches);
  let prefs = loadPreferences(), restoreToken = null, restoreGeneration = -1, previewRequest = 0;
  const applyPrefs = () => {
    $('speed').value = prefs.speed; $('audio').playbackRate = prefs.speed; $('follow').checked = prefs.follow;
    document.body.classList.toggle('focus-view', prefs.focus); $('focus-toggle').setAttribute('aria-pressed', String(prefs.focus)); $('focus-toggle').textContent = prefs.focus ? 'Exit focus' : 'Focus view';
    document.documentElement.dataset.theme = prefs.theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', prefs.theme === 'dark' ? '#181C1A' : '#F4F1EA');
    document.documentElement.dataset.readingFont = prefs.readingFont;
    for (const [id, key] of [['font-size','fontSize'],['line-height','lineHeight'],['reading-width','width'],['theme','theme'],['reading-font','readingFont']]) $(id).value = prefs[key];
    document.documentElement.style.setProperty('--reading-size', `${prefs.fontSize}px`); document.documentElement.style.setProperty('--reading-line', prefs.lineHeight); document.documentElement.style.setProperty('--reading-width', `${prefs.width}px`); update();
  };
  const savePrefs = () => { try { storage.setItem(preferencesKey(data.bookId), JSON.stringify(prefs)); applyPrefs(); } catch(e) { message(e.message); } };
  for (const [id,key] of [['speed','speed'],['font-size','fontSize'],['line-height','lineHeight'],['reading-width','width'],['theme','theme'],['reading-font','readingFont']]) $(id).addEventListener('change',()=>{ prefs[key] = ['theme','readingFont'].includes(key) ? $(id).value : Number($(id).value); savePrefs(); });
  $('follow').addEventListener('change',()=>{ prefs.follow=$('follow').checked; savePrefs(); });
  $('focus-toggle').onclick=()=>{ prefs.focus=!prefs.focus; document.querySelector('.transport').classList.remove('options-open'); $('playback-options').setAttribute('aria-expanded','false'); savePrefs(); };
  $('playback-options').onclick=()=>{ const open=document.querySelector('.transport').classList.toggle('options-open'); $('playback-options').setAttribute('aria-expanded',String(open)); };
  $('tools-toggle').onclick=()=>{ $('tools').hidden=!$('tools').hidden; $('tools-toggle').setAttribute('aria-expanded',String(!$('tools').hidden)); if (!$('tools').hidden) renderBook(); };
  function button(label, action) { const b=document.createElement('button'); b.textContent=label; b.onclick=run(action); return b; }
  function state(c) { return new SidecarStore(storage,data.bookId,c).state; }
  function review(c) { return JSON.parse(storage.getItem(reviewKey(data.bookId,c)) || '{"reviewed":false,"bookmarks":[]}'); }
  function saveReview(value) { storage.setItem(reviewKey(data.bookId,context().chapter),JSON.stringify(value)); renderChapter(); renderBook(); }
  function renderChapter() {
    const { chapter }=context(); if (!chapter) return;
    const r=review(chapter); $('chapter-reviewed').checked=r.reviewed;
    $('bookmarks').replaceChildren(...r.bookmarks.map(b=>{
      const row=document.createElement('div'); row.className='bookmark-row';
      row.append(button(b.label,()=>listen(b.time,false)),button('Remove',()=>{ if(confirm('Remove this bookmark?')) saveReview({...review(chapter),bookmarks:review(chapter).bookmarks.filter(x=>x.id!==b.id)}); })); return row;
    }));
    const index=data.chapters.findIndex(c=>c.id===chapter.id); $('previous-chapter').disabled=index===0; $('next-chapter').disabled=index===data.chapters.length-1;
  }
  $('chapter-reviewed').onchange=run(async()=>{ saveReview({...review(context().chapter),reviewed:$('chapter-reviewed').checked}); await flush(); });
  $('bookmark').onclick=run(async()=>{ const {chapter}=context(), t=$('audio').currentTime; const label=`${chapter.title} · ${Math.floor(t/60)}:${String(Math.floor(t%60)).padStart(2,'0')}`; saveReview({...review(chapter),bookmarks:[...review(chapter).bookmarks,{id:crypto.randomUUID(),label:label.trim().slice(0,200),time:t}]}); await flush(); });
  for(const [id,delta] of [['previous-chapter',-1],['next-chapter',1]]) $(id).onclick=run(async()=>{ const i=data.chapters.findIndex(c=>c.id===context().chapter.id); if(data.chapters[i+delta])await navigate(data.chapters[i+delta].id); });
  for(const [id,delta] of [['rewind',-10],['forward',10]]) $(id).onclick=run(()=>listen(Math.max(0,Math.min(context().chapter.duration,$('audio').currentTime+delta)),false));
  function renderBook() {
    const query=$('book-search').value.trim(), filter=$('review-filter').value, category=$('category-filter').value, results=[];
    const add=(c,label,body,action,quote)=>{if(results.length>=100)return;const el=document.createElement('article');el.className='result';const p=document.createElement('p');p.textContent=body;el.append(button(`${c.title} · ${label}`,action));if(quote){const excerpt=document.createElement('blockquote');excerpt.textContent=quote.length>220?quote.slice(0,217)+'…':quote;el.append(excerpt);}el.append(p);results.push(el);};
    const regex=query ? new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'giu') : null;
    for(const c of data.chapters){
      if(regex && !category && filter==='all') for(const m of c.source.text.matchAll(regex)) { const target={start:m.index,end:m.index+m[0].length};add(c,'Passage',c.source.text.slice(Math.max(0,m.index-45),m.index+120),async()=>{if(await navigate(c.id)===false)return; locate(target);});if(results.length>=100)break; }
      const s=state(c);
      if(query && !category && filter==='all' && s.notes.toLowerCase().includes(query.toLowerCase()))add(c,'Chapter notes',s.notes,async()=>{if(await navigate(c.id)===false)return;showNotes();});
      for(const cm of s.comments){if(filter==='open'&&cm.resolved||filter==='resolved'&&!cm.resolved||category&&cm.category!==category)continue;if(query&&!`${cm.body} ${cm.anchor.quote}`.toLowerCase().includes(query.toLowerCase()))continue;
        add(c,`${cm.category||'Comment'} · ${cm.resolved?'resolved':'open'}`,cm.body,async()=>{if(await navigate(c.id)===false)return;prefs.focus=false;applyPrefs();locate(cm.anchor);refresh(cm.id);},cm.anchor.quote);}
    }
    $('book-results').replaceChildren(...results);const totals=summary(data,records());$('book-progress').textContent=`${totals.reviewed} of ${data.chapters.length} chapters reviewed · ${totals.comments} comments · ${results.length}${results.length===100?' (first 100)':''} ${results.length===1?'result':'results'}`;
  }
  for(const id of ['book-search','review-filter','category-filter'])$(id).addEventListener(id==='book-search'?'input':'change',renderBook);
  const makeBackup = rs => ({format:'local-reader-backup',version:1,bookId:data.bookId,title:data.title,createdAt:new Date().toISOString(),chapters:identity(data),records:rs});
  const browserRecords=()=>{const out={};for(let i=0;i<browserStorage.length;i++){const key=browserStorage.key(i);if(key?.startsWith(`chapter-reader:v1:${encodeURIComponent(data.bookId)}:`))out[key]=browserStorage.getItem(key);}return out;};
  $('database-location').textContent=storage.databasePath?`Database: ${storage.databasePath}. Automatic snapshots are kept in its backups folder.`:'Direct-file mode: browser storage only. Use the local launcher for database saves and restore.';
  $('backup-book').onclick=run(async()=>{pause();await flush();const backup=storage.records?await (await fetch('./api/backup',{cache:'no-store'})).json():makeBackup(browserRecords());downloadFile(backup,`${data.bookId}.reader-backup.json`);message('Whole-book backup exported, including drafts and listening positions.');});
  $('export-markdown').onclick=run(async()=>{await flush();downloadFile(markdownBrief(data,storage.records||browserRecords()),`${data.bookId}.revision-notes.md`,'text/markdown');message('Revision brief exported. Unfinished drafts were excluded.');});
  function clearPreview() { previewRequest++; restoreToken=null; $('restore-preview').hidden=true; $('restore-report').replaceChildren(); message(''); }
  async function preview(backup, name='Reader recovery copy') {
    clearPreview(); const request=previewRequest;
    if(!storage.blocked)pause(); await flush(); validateBackup(data,backup);
    const p=await storage.request('preview',{backup}); if(request!==previewRequest)return;
    restoreToken=p.token; restoreGeneration=storage.generation;
    const created=new Date(backup.createdAt);
    $('restore-identity').textContent=`${name} · ${data.title} · ${Number.isNaN(created.getTime())?'Creation date unavailable':created.toLocaleString()}`;
    const changes=[];
    for(const [key,label] of [['notes','Chapter notes'],['comments','Saved comments'],['drafts','Unfinished drafts'],['bookmarks','Bookmarks'],['reviewed','Reviewed chapters']]) {
      const current=p.current[key], incoming=p.incoming[key], changed=current!==incoming;
      const row=document.createElement('tr'); row.classList.toggle('changed',changed);
      const heading=document.createElement('th'); heading.scope='row'; heading.textContent=label; row.append(heading);
      for(const value of [current,incoming,changed?`${incoming>current?'+':''}${incoming-current}`:'Same count']) {const cell=document.createElement('td');cell.textContent=value;row.append(cell);}
      $('restore-report').append(row);
      if(changed)changes.push(`${label}: ${current} → ${incoming}`);
    }
    $('restore-changes').textContent=changes.length?`Counts will change. ${changes.join('; ')}.`:'Counts match. Restoring still replaces the saved content.';
    $('restore-preview').hidden=false; $('restore-title').focus(); $('restore-preview').scrollIntoView({block:'start',behavior:'instant'});
  }
  $('restore-pick').disabled=!storage.request;
  $('restore-pick').onclick=()=>{clearPreview();$('restore-file').value='';$('restore-file').click();};
  $('restore-file').onchange=run(async()=>{clearPreview();const file=$('restore-file').files[0];if(!file)return;if(file.size>16*1024*1024)throw Error('Backup exceeds 16 MiB');await preview(JSON.parse(await file.text()),file.name);});
  $('restore-cancel').onclick=()=>{clearPreview();$('restore-pick').focus();};
  $('restore-apply').onclick=run(async()=>{if(!restoreToken)return;if(storage.dirty||storage.flight||storage.generation!==restoreGeneration)throw Error('Reader data changed after preview. Preview the backup again.');const controls=[...document.querySelectorAll('button,input,textarea,select')].map(el=>[el,el.disabled]);controls.forEach(([el])=>el.disabled=true);storage.restoring=true;let result;try{result=await storage.request('restore',{token:restoreToken});storage.accept(result);}finally{storage.restoring=false;controls.forEach(([el,disabled])=>el.disabled=disabled);}restoreToken=null;$('restore-preview').hidden=true;prefs=loadPreferences();applyPrefs();await navigate(JSON.parse(storage.getItem(selectedKey(data.bookId))||'null')?.chapterId || context().chapter.id,true);renderChapter();renderBook();message('Backup restored. The previous database snapshot was retained.');});
  $('retry-save').onclick=run(async()=>{await flush();message('Pending edits saved to the database.');});
  const legacy=browserRecords();
  $('migrate-browser').hidden=!storage.request||!Object.values(legacy).length;
  $('migrate-browser').onclick=run(()=>preview(makeBackup(legacy)));
  if(storage.request && Object.entries(legacy).some(([key,raw])=>{try{const value=JSON.parse(raw);return key.endsWith(':sidecar')&&(value.notes?.trim()||value.comments?.length||value.draft);}catch{return true;}}) && !Object.keys(storage.records).some(k=>k.endsWith(':sidecar')))message('Existing browser notes were preserved. Open Search & book tools → Backups & exports to review their import.');
  let pending=null;try{pending=JSON.parse(storage.pendingRecovery||'null');}catch{message('An unreadable browser recovery copy was retained. Export recovery data before changing it.');}
  $('recover-pending').hidden=!storage.request||!pending||pending.acknowledged||JSON.stringify(pending.records)===JSON.stringify(storage.records);
  $('recover-pending').onclick=run(()=>preview(makeBackup(pending.records)));
  const recoveryButtons=()=>{$('retry-save').hidden=!storage.error||storage.blocked;$('keep-database').hidden=!storage.blocked;};
  window.addEventListener('reader-storage',recoveryButtons);recoveryButtons();
  $('keep-database').onclick=run(async()=>{const raw=storage.pendingRecovery||browserStorage.getItem(storage.recoveryKey);if(raw)browserStorage.setItem(storage.recoveryKey+':retained:'+crypto.randomUUID(),raw);const response=await fetch('./api/session',{cache:'no-store'});if(!response.ok)throw Error('Database is unavailable');storage.accept(await response.json());storage.pendingRecovery=null;prefs=loadPreferences();applyPrefs();await navigate(context().chapter.id,true);renderChapter();renderBook();message('Saved database version loaded. The earlier browser recovery copy was retained.');});
  applyPrefs();renderChapter();renderBook();return {renderChapter,renderBook};
}
