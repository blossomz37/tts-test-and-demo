import { DatabaseStorage } from './database-client.mjs';
import { mountWorkspace } from './workspace.mjs';
import { mountReadingLayout } from './reading-layout.mjs';
import { anchor, snapToWords, relativeTime } from '../src/comments.mjs';
import { Dictation, appendTranscript } from '../src/dictation.mjs';
import { SidecarStore, positionKey, readPosition } from './state.mjs';
import { sentenceCueAnchors, playbackAction, shouldFollowAudio } from './reading-state.mjs';

const data = window.CHAPTER_READER, $ = id => document.getElementById(id), audio = $('audio');
let chapter, store, spans = [], selected = null, epoch = 0, raf = 0, loaded = false, ready = false;
let pendingPosition = 0, positionBlocked = false, positionError = '', lastSave = 0, lastFollow = -1, dictationTarget = null, composerOpen = false;
const time = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
const status = message => { $('play-status').textContent = message; };
const selectionKey = `chapter-reader:v1:${encodeURIComponent(data.bookId)}:selected`;
let selectionBlocked = false;
let storage, browserStorage, workspace, databaseUnavailable = '', mutationBusy = false;
let cueEvents = [], eventCursor = 0, previousTime = -1, activeSpans = new Set();
let sentenceAnchors = [], positionCue = -1, markerSentence = -1, markerLayoutDirty = true;
try { storage = window.localStorage; } catch {
  storage = { getItem() { throw Error('Browser storage is unavailable'); }, setItem() { throw Error('Browser storage is unavailable'); } };
}

browserStorage = storage;

function download(payload, name) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2) + '\n'], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function storageStatus() {
  const error = databaseUnavailable || storage.error || store?.error || positionError;
  $('storage-status').textContent = error || (storage.records ? (storage.dirty ? 'Saving reader data to local database…' : 'Reader data saved to local database.') : 'Reader notes and drafts saved in this browser.');
  $('storage-status').classList.toggle('error', !!error);
  $('recovery').hidden = !error;
  if (store?.state.draft) {
    const draftSave=error?'Draft save not confirmed.':storage.dirty || store.dirty?'Saving draft…':storage.records?'Draft saved locally.':'Draft saved in this browser.';
    $('draft-status').textContent=`${draftSave} ${store.state.draft.commentId?'The saved comment is unchanged. Save comment to update it.':'Save comment to add it to your saved comments and revision exports.'}`;
    $('draft-status').classList.toggle('error',!!error);
  } else $('draft-status').textContent='';
  const blocked = !ready || store?.blocked || storage.blocked || !!databaseUnavailable || mutationBusy;
  for (const id of ['notes', 'comment-body', 'dictate-notes', 'dictate-comment', 'discard', 'comment-category']) $(id).disabled = blocked;
  if (dictation.state === 'stopping') $('dictate-notes').disabled = $('dictate-comment').disabled = true;
  $('save-comment').disabled = blocked || dictation.state !== 'idle';
  $('comment-selection').disabled = blocked || !selected;
  $('listen-selection').disabled = !ready || !selected;
  $('chapter').disabled = mutationBusy;
  for (const id of ['rewind','forward','bookmark','chapter-reviewed']) $(id).disabled = !ready || !!databaseUnavailable || mutationBusy;
  if (error) { $('action-status').textContent = error + ' Export recovery data before leaving.'; $('recovery').hidden = false; }
}
function rangeFor(target) {
  const walker = document.createTreeWalker($('passage'), NodeFilter.SHOW_TEXT), range = document.createRange();
  let node, offset = 0;
  while ((node = walker.nextNode())) {
    const end = offset + node.length;
    if (target.start >= offset && target.start < end) range.setStart(node, target.start - offset);
    if (target.end > offset && target.end <= end) { range.setEnd(node, target.end - offset); return range; }
    offset = end;
  }
}
function mark(target) {
  if (!globalThis.CSS?.highlights) return;
  CSS.highlights.delete('comment-target');
  if (target) { const highlight = new Highlight(rangeFor(target)); highlight.priority = 2; CSS.highlights.set('comment-target', highlight); }
}
function locate(target) {
  readingLayout.close();
  mark(target);
  const el = spans.find(s => s.cue.from >= target.start)?.span || $('passage');
  scrollToPassage(el);
}
function showComposer() {
  const draft = store.state.draft; if (!draft) return;
  composerOpen = true; document.body.classList.add('composer-open'); $('composer').hidden = false; $('resume-draft').hidden = true;
  $('composer-title').textContent = draft.commentId ? 'Edit comment' : 'Comment on selection';
  $('comment-category').value = draft.category || '';
  $('quote').textContent = draft.anchor.quote; $('comment-body').value = draft.body;
  mark(draft.anchor); readingLayout.show($('comment-body')); storageStatus();
}
function renderComments(selectedId) {
  const comments = store.state.comments;
  $('comment-count').textContent = comments.length ? `(${comments.length})` : '';
  $('empty-comments').hidden = comments.length > 0;
  if (globalThis.CSS?.highlights) { const highlight = new Highlight(...comments.map(c => rangeFor(c.anchor))); highlight.priority = 1; CSS.highlights.set('saved-comments', highlight); }
  $('comments').replaceChildren(...comments.map(c => {
    const card = document.createElement('article'); card.className = `comment-card${c.resolved ? ' resolved' : ''}${c.id === selectedId ? ' selected' : ''}`; card.dataset.id = c.id;
    const quote = document.createElement('blockquote'); quote.textContent = c.anchor.quote;
    const body = document.createElement('p'); body.textContent = c.body;
    const when = document.createElement('time'); when.dateTime = c.updatedAt || c.createdAt; when.textContent = `${c.updatedAt ? 'Edited ' : ''}${relativeTime(when.dateTime)}`;
    const meta = document.createElement('div'); meta.className = 'comment-meta'; meta.textContent = `${c.category || 'Uncategorized'} · ${c.resolved ? 'resolved' : 'open'}`;
    const actions = document.createElement('div'); actions.className = 'actions';
    for (const [label, action] of [
      ['Show passage', () => locate(c.anchor)],
      ['Listen', () => void listenFrom(c.anchor)],
      [c.resolved ? 'Reopen' : 'Resolve', () => void mutateSaved(() => store.write({ ...store.state, comments: store.state.comments.map(x => x.id === c.id ? { ...x, resolved: !x.resolved, updatedAt: new Date().toISOString() } : x) } ))],
      ['Edit', () => {
        pauseForWriting();
        if (store.state.draft && store.state.draft.commentId !== c.id) { showComposer(); status('Finish or discard the open draft first.'); return; }
        if (!store.state.draft) store.draft({ commentId: c.id, anchor: c.anchor, body: c.body, category: c.category || '' });
        showComposer();
      }],
      ['Delete', async () => {
        if (!confirm('Delete this saved comment and any draft of its edits?')) return;
        dictation.cancel();
        await mutateSaved(() => store.deleteComment(c.id));
        storageStatus();
      }]
    ]) {
      const button = document.createElement('button'); button.textContent = label; button.disabled = label !== 'Show passage' && (store.blocked || !ready); button.onclick = action; actions.append(button);
    }
    card.append(meta, quote, body, when, actions); return card;
  }));
  $('resume-draft').hidden = !store.state.draft || composerOpen;
  if (selectedId) {
    readingLayout.show();
    const card = $('comments').querySelector('.selected'); if (card) readingLayout.reveal(card);
  }
  workspace?.renderBook();
}
function closeComposer() { composerOpen = false; document.body.classList.remove('composer-open'); $('composer').hidden = true; $('resume-draft').hidden = !store.state.draft; mark(null); }
async function mutateSaved(action) {
  if (mutationBusy || storage.blocked) return;
  pauseForWriting(); mutationBusy = true; storageStatus();
  const previous = structuredClone(store.state), originalRecords = storage.records && { ...storage.records };
  try {
    await storage.flush?.();
    if (!action()) throw Error(store.error || 'Change could not be saved');
    await storage.flush?.();
    if (!store.state.draft) closeComposer();
  } catch (error) {
    store.state = previous;
    if (originalRecords && storage.error) { storage.records = originalRecords; storage.blocked = true; store.blocked = true; }
    store.error = error.message + ' Saved comment change was not confirmed; export recovery and reload.';
  } finally { mutationBusy = false; renderComments(); storageStatus(); }
}
function pauseForWriting() { epoch++; audio.pause(); savePosition(); dictation.cancel(); }
const readingLayout = mountReadingLayout({ rangeFor, pause: pauseForWriting, cancelDictation: () => dictation.cancel() });
function scrollToPassage(element) {
  const top = Math.max(0, document.querySelector('.transport').getBoundingClientRect().bottom,
    $('reading-toolbar').getBoundingClientRect().bottom);
  const available = Math.max(44, innerHeight - top - 110);
  window.scrollBy({ top: element.getBoundingClientRect().top - top - available / 3, behavior: 'instant' });
}

const dictation = new Dictation({ Recognition: window.SpeechRecognition || window.webkitSpeechRecognition,
  append: words => {
    const target = dictationTarget;
    if (!target || target.chapterId !== chapter.id || store.blocked) return;
    if (target.field === 'notes') {
      $('notes').value = appendTranscript($('notes').value, words); store.notes($('notes').value);
    } else if (store.state.draft && target.draft === store.state.draft.anchor) {
      $('comment-body').value = appendTranscript($('comment-body').value, words);
      store.draft({ ...store.state.draft, body: $('comment-body').value });
    }
    storageStatus();
  },
  emit: event => {
    if (event.interim !== undefined) {
      $('notes-interim').textContent = dictationTarget?.field === 'notes' ? event.interim : '';
      $('comment-interim').textContent = dictationTarget?.field === 'comment' ? event.interim : '';
    }
    if (event.message) $('dictation-status').textContent = event.message.replace('your notes', dictationTarget?.field === 'comment' ? 'your comment draft' : 'your notes').replace('Notes saved on this device.', 'Dictation stopped. Review your text.');
    const active = event.state !== 'idle';
    for (const [id, field, label] of [['dictate-notes', 'notes', 'Dictate notes'], ['dictate-comment', 'comment', 'Dictate comment']]) {
      const own = active && dictationTarget?.field === field;
      $(id).textContent = own ? (event.state === 'preparing' ? 'Cancel setup' : event.state === 'listening' ? 'Listening · Stop' : 'Stop dictation') : label;
      $(id).setAttribute('aria-pressed', String(own));
      $(id).dataset.listening = String(own && event.state === 'listening');
    }
    if (store) storageStatus();
  }
});
function dictate(field) {
  if (store.blocked || !ready) return;
  if (dictation.state !== 'idle' && dictationTarget?.field === field) { dictation.stop(); return; }
  pauseForWriting();
  if (field === 'comment' && !store.state.draft) return;
  dictationTarget = { chapterId: chapter.id, field, draft: store.state.draft?.anchor };
  void dictation.start();
}

function renderPassage() {
  let cursor = 0; spans = []; const fragment = document.createDocumentFragment();
  for (const cue of chapter.cues) {
    fragment.append(document.createTextNode(chapter.source.text.slice(cursor, cue.from)));
    const span = document.createElement('span'); span.className = 'word'; span.textContent = chapter.source.text.slice(cue.from, cue.to); span.dataset.from = cue.from;
    fragment.append(span); spans.push({ span, cue }); cursor = cue.to;
  }
  fragment.append(document.createTextNode(chapter.source.text.slice(cursor))); $('passage').replaceChildren(fragment);
  if ($('passage').textContent !== chapter.source.text) throw Error('Text preservation check failed');
  readingLayout.setChapter(chapter.source.text);
  cueEvents = spans.flatMap((item,i) => [{time:item.cue.start, i, enter:true}, {time:item.cue.displayEnd, i, enter:false}]).sort((a,b)=>a.time-b.time || Number(a.enter)-Number(b.enter));
  sentenceAnchors = sentenceCueAnchors(chapter.source.text, chapter.cues);
  eventCursor=0; previousTime=-1; activeSpans=new Set(); positionCue=-1; markerSentence=-1; markerLayoutDirty=true;
}
function updatePositionMarker() {
  const marker = $('playback-position'), sentence = sentenceAnchors[positionCue];
  marker.hidden = !ready || audio.ended || sentence === undefined;
  if (marker.hidden || sentence === markerSentence && !markerLayoutDirty) return;
  // A sentence's first verified word supplies a stable gutter position. This is
  // a geometry read on sentence/layout changes, never a per-frame source scan.
  const rect = spans[sentence].span.getClientRects()[0];
  if (!rect) { marker.hidden = true; return; }
  marker.style.top = `${rect.top - marker.parentElement.getBoundingClientRect().top}px`;
  markerSentence = sentence; markerLayoutDirty = false;
}
function refreshPositionLayout() { markerLayoutDirty = true; updatePositionMarker(); }
if (globalThis.ResizeObserver) new ResizeObserver(refreshPositionLayout).observe($('passage'));
window.addEventListener('resize', refreshPositionLayout);
document.fonts?.ready.then(refreshPositionLayout);
function update() {
  if (!chapter) return;
  const t = loaded ? audio.currentTime || 0 : pendingPosition, duration = chapter.duration;
  $('seek').max = duration; $('seek').value = t; $('elapsed').textContent = time(t); $('duration').textContent = time(duration);
  $('seek').setAttribute('aria-valuetext', `${time(t)} of ${time(duration)}`);
  $('remaining').textContent = `${time(Math.max(0, duration - t) / Number($('speed').value))} remaining`;
  if (t < previousTime || !ready || audio.ended) { for (const i of activeSpans) spans[i]?.span.classList.remove('current'); activeSpans.clear(); eventCursor=0; positionCue=-1; }
  if (ready && !audio.ended) while(eventCursor < cueEvents.length && cueEvents[eventCursor].time <= t) {
    const event=cueEvents[eventCursor++];
    if(event.enter) { activeSpans.add(event.i); positionCue=event.i; } else activeSpans.delete(event.i);
    spans[event.i].span.classList.toggle('current',event.enter);
  }
  previousTime=t; const activeIndex=activeSpans.size ? Math.max(...activeSpans) : -1;
  updatePositionMarker();
  const editing = composerOpen && $('composer').getClientRects().length > 0 || dictation.state !== 'idle' || !!document.activeElement?.matches('textarea,input:not([type=range]):not([type=checkbox])');
  if (shouldFollowAudio({ follow: $('follow').checked, activeIndex, lastFollow, selectionCollapsed: getSelection().isCollapsed, editing })) {
    lastFollow = activeIndex;
    const el = spans[activeIndex].span, rect = el.getBoundingClientRect(), top = Math.max(0, document.querySelector('.transport').getBoundingClientRect().bottom, $('reading-toolbar').getBoundingClientRect().bottom);
    if (rect.top < top + 20 || rect.bottom > innerHeight - 110) scrollToPassage(el);
  }
  const action = playbackAction(audio.paused, audio.ended, t);
  document.body.dataset.playback = audio.ended ? 'finished' : !audio.paused ? 'playing' : t > 0 ? 'paused' : 'ready';
  $('play').textContent = action;
  $('play').setAttribute('aria-label', `${action} narration`);
  $('compact-play').textContent=action;
  $('compact-play').setAttribute('aria-label', `${action} narration — compact player`);
  for(const id of ['compact-play','compact-rewind','compact-forward'])$(id).disabled=!ready||!loaded;
  $('compact-chapter').textContent=chapter.title;
  $('compact-time').textContent=`${time(t)} / ${time(duration)}`;
}
function frame() { update(); if (!audio.paused && !audio.ended) raf = requestAnimationFrame(frame); }
function savePosition() {
  if (!chapter || !loaded || positionBlocked || storage.restoring) return;
  try {
    storage.setItem(positionKey(data.bookId, chapter), JSON.stringify({ sourceSha256: chapter.source.sha256, audioSha256: chapter.audioSha256, time: audio.currentTime }));
  } catch { positionError = 'Listening position could not be saved. Notes have their own storage status.'; storageStatus(); }
}
async function verify(ch, token) {
  if (crypto.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ch.source.text));
    const hex = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
    if (hex !== ch.source.sha256) throw Error('Generated source hash mismatch. Regenerate the reader.');
  }
  if (location.protocol === 'file:') return 'Direct-file mode: approximate timing. Live audio/source changes cannot be checked here. Use the launcher for stable notes and dictation.';
  const response = await fetch(`./integrity/${ch.id}`, { cache: 'no-store' });
  const result = await response.json();
  if (token !== epoch) return '';
  if (!response.ok || !result.ok || result.sourceSha256 !== ch.source.sha256 || result.audioSha256 !== ch.audioSha256 || result.narrationSha256 !== ch.narrationSha256 || result.alignmentSha256 !== ch.alignmentSha256) throw Error(result.error || 'Inputs differ from this reader. Regenerate before playing or annotating.');
  return 'Source and audio hashes verified · approximate word timing' + (ch.alignmentWarnings?.length ? ` · Alignment warning: ${ch.alignmentWarnings.join('; ')}` : '');
}
async function listenAt(t, play = true) {
  if (!ready) return;
  if (!loaded) await new Promise((resolve, reject) => {
    const timer=setTimeout(()=>{audio.removeEventListener('loadedmetadata',done);reject(Error('Recording is still loading. Try again.'));},10000);
    const done=()=>{clearTimeout(timer);resolve();};audio.addEventListener('loadedmetadata',done,{once:true});
  });
  audio.currentTime=t; lastFollow=-1; update(); savePosition();
  if(play) {dictation.cancel(); await audio.play();}
}
async function listenFrom(target) {
  readingLayout.close();
  const cue=chapter.cues.find(c=>c.to>target.start); if(cue) {try{await listenAt(cue.start);}catch(error){status(error.message);}}
}
async function selectChapter(id, force = false) {
  if (mutationBusy) return false;
  if (chapter?.id === id && !force) return ready;
  try { await storage.flush?.(); } catch(error) { status(error.message); $('chapter').value=chapter?.id || id; return false; }
  if (store?.dirty && !store.write()) { $('chapter').value = chapter.id; storageStatus(); return false; }
  if (!force) savePosition(); loaded = false; ready = false; epoch++; const token = epoch;
  audio.pause(); audio.removeAttribute('src'); audio.load(); cancelAnimationFrame(raf); dictation.cancel();
  chapter = data.chapters.find(c => c.id === id) || data.chapters[0];
  $('chapter').value = chapter.id; $('chapter-title').textContent = chapter.title;
  store = new SidecarStore(storage, data.bookId, chapter); $('notes').value = store.state.notes;
  selected = null; closeComposer(); lastFollow = -1; positionBlocked = false; positionError = '';
  pendingPosition = 0;
  try { pendingPosition = readPosition(storage.getItem(positionKey(data.bookId, chapter)), chapter); }
  catch (error) { positionBlocked = true; positionError = error.message; }
  if (!selectionBlocked) try { storage.setItem(selectionKey, JSON.stringify({ chapterId: chapter.id })); } catch { selectionBlocked = true; positionError ||= 'Selected chapter could not be saved.'; }
  renderPassage(); renderComments(); update(); storageStatus(); workspace?.renderChapter();
  $('play').disabled = $('restart').disabled = $('seek').disabled = true;
  status('Checking chapter…'); $('integrity').textContent = ''; $('integrity').classList.remove('error');
  try {
    const message = await verify(chapter, token); if (token !== epoch) return;
    ready = true; $('integrity').textContent = message;
    audio.src = chapter.audio; audio.load(); audio.playbackRate = Number($('speed').value);
    renderComments(); storageStatus(); status('Loading recording…'); return true;
  } catch (error) {
    if (token !== epoch) return;
    $('integrity').textContent = error.message; $('integrity').classList.add('error'); $('integrity').closest('details').open = true; status('Playback and annotation paused until inputs are verified. Existing notes can be exported.');
  }
}

$('book-title').textContent = data.title; document.title = `${data.title} · Chapter reader`;
$('chapter').replaceChildren(...data.chapters.map(c => { const o = document.createElement('option'); o.value = c.id; o.textContent = c.title; return o; }));
$('chapter').onchange = () => void selectChapter($('chapter').value);
$('play').onclick = async () => {
  if (!ready || !loaded) return;
  if (!audio.paused) { audio.pause(); return; }
  dictation.cancel(); dictationTarget = null; const token = ++epoch;
  if (audio.ended) audio.currentTime = 0;
  try { await audio.play(); } catch (error) { if (token === epoch) status(`Playback could not start: ${error.message}`); }
};
$('compact-play').onclick=()=>$('play').click();
for(const [id,delta] of [['compact-rewind',-10],['compact-forward',10]])$(id).onclick=()=>void listenAt(Math.max(0,Math.min(chapter.duration,audio.currentTime+delta)),false).catch(error=>status(error.message));
function compactVisibility() {
  const typing=document.activeElement?.matches('textarea,input:not([type=range]):not([type=checkbox]),select');
  $('compact-player').hidden=!matchMedia('(max-width:760px)').matches || document.querySelector('.transport').getBoundingClientRect().bottom>0 || typing || $('notes-dialog').open || !$('restore-preview').hidden;
}
window.addEventListener('scroll',compactVisibility,{passive:true});
window.addEventListener('resize',compactVisibility);
document.addEventListener('focusin',compactVisibility);
document.addEventListener('focusout',()=>queueMicrotask(compactVisibility));
$('notes-dialog').addEventListener('close',compactVisibility);
$('restart').onclick = () => { audio.currentTime = 0; lastFollow = -1; update(); savePosition(); };
$('seek').oninput = () => { audio.currentTime = Number($('seek').value); lastFollow = -1; update(); };
$('speed').onchange = () => { audio.playbackRate = Number($('speed').value); update(); };
$('follow').onchange = () => { lastFollow = -1; update(); };
audio.addEventListener('loadedmetadata', () => {
  if (!ready || audio.currentSrc !== new URL(chapter.audio, location.href).href) return;
  if (Math.abs(audio.duration - chapter.duration) > 1) { ready = false; $('integrity').textContent = 'Audio duration differs from the recorded receipt. Regenerate and verify the inputs.'; $('integrity').classList.add('error'); storageStatus(); return; }
  loaded = true; audio.currentTime = pendingPosition; audio.playbackRate = Number($('speed').value);
  $('play').disabled = $('restart').disabled = $('seek').disabled = false; update(); status(pendingPosition ? 'Listening position restored. Press Resume to continue.' : 'Ready to play.');
});
audio.addEventListener('playing', () => {
  if (!ready || dictation.state !== 'idle') { audio.pause(); return; }
  cancelAnimationFrame(raf); status('Playing.'); frame();
});
audio.addEventListener('pause', () => { cancelAnimationFrame(raf); if (chapter) { update(); savePosition(); if (ready) status('Paused.'); } });
audio.addEventListener('ended', () => { cancelAnimationFrame(raf); update(); savePosition(); status('Chapter finished.'); });
audio.addEventListener('timeupdate', () => { if (!chapter) return; update(); if (Date.now() - lastSave > 1500) { savePosition(); lastSave = Date.now(); } });
audio.addEventListener('seeked', () => { update(); savePosition(); });
audio.addEventListener('error', () => { if (ready) status('Audio is unavailable. Check the MP3 and launch the local server.'); });

document.addEventListener('selectionchange', () => {
  selected = null; const selection = getSelection();
  if (chapter && selection.rangeCount && !selection.isCollapsed) {
    const range = selection.getRangeAt(0), passage = $('passage');
    if (passage.contains(range.startContainer) && passage.contains(range.endContainer)) {
      const before = document.createRange(); before.selectNodeContents(passage); before.setEnd(range.startContainer, range.startOffset);
      try { const snap = snapToWords(chapter.source.text, before.toString().length, before.toString().length + range.toString().length); selected = anchor(chapter.source.text, snap.start, snap.end); } catch { /* An empty selection is not a comment anchor. */ }
    }
  }
  if (store) storageStatus();
});
$('listen-selection').onpointerdown = event => event.preventDefault();
$('listen-selection').onclick = () => selected && void listenFrom(selected);
$('comment-category').onchange = () => { if(store.state.draft) store.draft({...store.state.draft,category:$('comment-category').value}); storageStatus(); };
$('passage').onclick = event => {
  if(!getSelection().isCollapsed)return;
  const word=event.target.closest('.word');if(!word)return;const offset=Number(word.dataset.from);
  const comment=store.state.comments.find(c=>offset<c.anchor.end && offset>=c.anchor.start);
  if(comment){locate(comment.anchor);renderComments(comment.id);}
};
$('comment-selection').onpointerdown = event => event.preventDefault();
$('comment-selection').onclick = () => {
  if (!selected || store.blocked || !ready) return;
  pauseForWriting(); if (!store.state.draft) store.draft({ anchor: selected, body: '' });
  showComposer();
};
$('notes').oninput = () => { store.notes($('notes').value); storageStatus(); };
$('comment-body').oninput = () => { if (store.state.draft) store.draft({ ...store.state.draft, body: $('comment-body').value }); storageStatus(); };
$('dictate-notes').onclick = () => dictate('notes'); $('dictate-comment').onclick = () => dictate('comment');
$('save-comment').onclick = () => { if(dictation.state==='idle') void mutateSaved(()=>store.saveComment()); };
$('back').onclick = () => { dictation.cancel(); closeComposer(); renderComments(); };
$('resume-draft').onclick = () => { pauseForWriting(); showComposer(); };
$('discard').onclick = async () => {
  if (!confirm('Discard this unfinished draft? The saved comment, if any, will be kept.')) return;
  dictation.cancel(); await mutateSaved(()=>store.write({ ...store.state, draft: null }));
};
$('export').onclick = async () => { try { await storage.flush?.(); download(store.export(), `${data.bookId}-${chapter.id}.comments.json`); } catch(e) { status(e.message); } };
$('recovery').onclick = () => download({chapter:store.recovery(),database:storage.records?{revision:storage.revision,records:storage.records,pendingRecovery:storage.pendingRecovery || browserStorage.getItem(storage.recoveryKey)}:null}, `${data.bookId}-${chapter.id}.recovery.json`);
window.addEventListener('storage', event => {
  if (storage.records) return;
  if (event.key === store?.key || event.key === null) {
    dictation.cancel(); store.blocked = true; store.error = 'Another tab changed these notes. Export recovery data, then reload.'; storageStatus(); renderComments();
  }
});
window.addEventListener('pagehide', () => { savePosition(); dictation.cancel(); audio.pause(); });
window.addEventListener('beforeunload', event => { if (store?.dirty || storage.dirty) { event.preventDefault(); event.returnValue = ''; } });
document.addEventListener('visibilitychange', () => { if (document.hidden) savePosition(); });
window.addEventListener('reader-storage',()=>{if(store)storageStatus();});
async function initialize() {
  if(location.protocol!=='file:') {
    try { storage=await DatabaseStorage.connect(browserStorage,data); }
    catch(error) {databaseUnavailable=error.message;}
  }
  let initial=data.chapters[0].id;
  try {const raw=storage.getItem(selectionKey);if(raw!==null){const saved=JSON.parse(raw);if(!data.chapters.some(c=>c.id===saved.chapterId))throw Error('Saved chapter missing');initial=saved.chapterId;}}
  catch {selectionBlocked=true;}
  await selectChapter(initial);
  workspace=mountWorkspace({data,storage,browserStorage,context:()=>({chapter,store}),navigate:selectChapter,listen:listenAt,locate,showNotes:()=>readingLayout.show($('notes')),update:()=>{markerLayoutDirty=true;readingLayout.refresh();update();},pause:pauseForWriting,refresh:renderComments});
  storageStatus();
}
void initialize().catch(error=>{databaseUnavailable=error.message;status(error.message);if(store)storageStatus();});
