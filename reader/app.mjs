import { anchor, snapToWords, relativeTime } from '../src/comments.mjs';
import { Dictation, appendTranscript } from '../src/dictation.mjs';
import { SidecarStore, positionKey, readPosition } from './state.mjs';

const data = window.CHAPTER_READER, $ = id => document.getElementById(id), audio = $('audio');
let chapter, store, spans = [], selected = null, epoch = 0, raf = 0, loaded = false, ready = false;
let pendingPosition = 0, positionBlocked = false, positionError = '', lastSave = 0, lastFollow = -1, dictationTarget = null, composerOpen = false;
const time = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
const status = message => { $('play-status').textContent = message; };
const selectionKey = `chapter-reader:v1:${encodeURIComponent(data.bookId)}:selected`;
let selectionBlocked = false;
let storage;
try { storage = window.localStorage; } catch {
  storage = { getItem() { throw Error('Browser storage is unavailable'); }, setItem() { throw Error('Browser storage is unavailable'); } };
}

function download(payload, name) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2) + '\n'], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function storageStatus() {
  const error = store?.error || positionError;
  $('storage-status').textContent = error || 'Notes and drafts saved in this browser.';
  $('storage-status').classList.toggle('error', !!error);
  $('recovery').hidden = !error;
  const blocked = !ready || store?.blocked;
  for (const id of ['notes', 'comment-body', 'dictate-notes', 'dictate-comment', 'discard']) $(id).disabled = blocked;
  if (dictation.state === 'stopping') $('dictate-notes').disabled = $('dictate-comment').disabled = true;
  $('save-comment').disabled = blocked || dictation.state !== 'idle';
  $('comment-selection').disabled = blocked || !selected;
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
  if (target) CSS.highlights.set('comment-target', new Highlight(rangeFor(target)));
}
function locate(target) {
  mark(target);
  const el = spans.find(s => s.cue.from >= target.start)?.span || $('passage');
  el.scrollIntoView({ block: 'center', behavior: 'instant' });
}
function showComposer() {
  const draft = store.state.draft; if (!draft) return;
  composerOpen = true; $('composer').hidden = false; $('resume-draft').hidden = true;
  $('composer-title').textContent = draft.commentId ? 'Edit comment' : 'Comment on selection';
  $('quote').textContent = draft.anchor.quote; $('comment-body').value = draft.body;
  mark(draft.anchor); $('comment-body').focus(); storageStatus();
}
function renderComments() {
  const comments = store.state.comments;
  $('comment-count').textContent = comments.length ? `(${comments.length})` : '';
  $('empty-comments').hidden = comments.length > 0;
  if (globalThis.CSS?.highlights) CSS.highlights.set('saved-comments', new Highlight(...comments.map(c => rangeFor(c.anchor))));
  $('comments').replaceChildren(...comments.map(c => {
    const card = document.createElement('article'); card.className = 'comment-card'; card.dataset.id = c.id;
    const quote = document.createElement('blockquote'); quote.textContent = c.anchor.quote;
    const body = document.createElement('p'); body.textContent = c.body;
    const when = document.createElement('time'); when.dateTime = c.updatedAt || c.createdAt; when.textContent = `${c.updatedAt ? 'Edited ' : ''}${relativeTime(when.dateTime)}`;
    const actions = document.createElement('div'); actions.className = 'actions';
    for (const [label, action] of [
      ['Show passage', () => locate(c.anchor)],
      ['Edit', () => {
        pauseForWriting();
        if (store.state.draft && store.state.draft.commentId !== c.id) { showComposer(); status('Finish or discard the open draft first.'); return; }
        if (!store.state.draft) store.draft({ commentId: c.id, anchor: c.anchor, body: c.body });
        showComposer();
      }],
      ['Delete', () => {
        if (!confirm('Delete this saved comment and any draft of its edits?')) return;
        dictation.cancel();
        if (store.deleteComment(c.id)) { if (!store.state.draft) closeComposer(); renderComments(); }
        storageStatus();
      }]
    ]) {
      const button = document.createElement('button'); button.textContent = label; button.disabled = label !== 'Show passage' && (store.blocked || !ready); button.onclick = action; actions.append(button);
    }
    card.append(quote, body, when, actions); return card;
  }));
  $('resume-draft').hidden = !store.state.draft || composerOpen;
}
function closeComposer() { composerOpen = false; $('composer').hidden = true; $('resume-draft').hidden = !store.state.draft; mark(null); }
function pauseForWriting() { epoch++; audio.pause(); savePosition(); dictation.cancel(); }

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
      $(id).textContent = own ? (event.state === 'preparing' ? 'Cancel setup' : 'Stop dictation') : label;
      $(id).setAttribute('aria-pressed', String(own));
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
}
function update() {
  const t = loaded ? audio.currentTime || 0 : pendingPosition, duration = chapter.duration;
  $('seek').max = duration; $('seek').value = t; $('elapsed').textContent = time(t); $('duration').textContent = time(duration);
  $('seek').setAttribute('aria-valuetext', `${time(t)} of ${time(duration)}`);
  let activeIndex = -1;
  spans.forEach(({ span, cue }, i) => {
    const active = ready && !audio.ended && t >= cue.start && t < cue.displayEnd;
    span.classList.toggle('current', active); if (active) activeIndex = i;
  });
  if ($('follow').checked && activeIndex >= 0 && activeIndex !== lastFollow && getSelection().isCollapsed) {
    lastFollow = activeIndex;
    const el = spans[activeIndex].span, rect = el.getBoundingClientRect(), top = document.querySelector('.transport').getBoundingClientRect().bottom;
    if (rect.top < top + 35 || rect.bottom > innerHeight - 70) el.scrollIntoView({ block: 'center', behavior: 'instant' });
  }
  $('play').textContent = audio.paused ? 'Play' : 'Pause';
  $('play').setAttribute('aria-label', audio.paused ? 'Play narration' : 'Pause narration');
}
function frame() { update(); if (!audio.paused && !audio.ended) raf = requestAnimationFrame(frame); }
function savePosition() {
  if (!chapter || !loaded || positionBlocked) return;
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
async function selectChapter(id) {
  if (store?.dirty && !store.write()) { $('chapter').value = chapter.id; storageStatus(); return; }
  savePosition(); loaded = false; ready = false; epoch++; const token = epoch;
  audio.pause(); audio.removeAttribute('src'); audio.load(); cancelAnimationFrame(raf); dictation.cancel();
  chapter = data.chapters.find(c => c.id === id) || data.chapters[0];
  $('chapter').value = chapter.id; $('chapter-title').textContent = chapter.title;
  store = new SidecarStore(storage, data.bookId, chapter); $('notes').value = store.state.notes;
  selected = null; composerOpen = false; $('composer').hidden = true; mark(null); lastFollow = -1; positionBlocked = false; positionError = '';
  pendingPosition = 0;
  try { pendingPosition = readPosition(storage.getItem(positionKey(data.bookId, chapter)), chapter); }
  catch (error) { positionBlocked = true; positionError = error.message; }
  if (!selectionBlocked) try { storage.setItem(selectionKey, JSON.stringify({ chapterId: chapter.id })); } catch { selectionBlocked = true; positionError ||= 'Selected chapter could not be saved.'; }
  renderPassage(); renderComments(); update(); storageStatus();
  $('play').disabled = $('restart').disabled = $('seek').disabled = true;
  status('Checking chapter…'); $('integrity').textContent = ''; $('integrity').classList.remove('error');
  try {
    const message = await verify(chapter, token); if (token !== epoch) return;
    ready = true; $('integrity').textContent = message;
    audio.src = chapter.audio; audio.load(); audio.playbackRate = Number($('speed').value);
    renderComments(); storageStatus(); status('Loading recording…');
  } catch (error) {
    if (token !== epoch) return;
    $('integrity').textContent = error.message; $('integrity').classList.add('error'); status('Playback and annotation paused until inputs are verified. Existing notes can be exported.');
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
$('restart').onclick = () => { audio.currentTime = 0; lastFollow = -1; update(); savePosition(); };
$('seek').oninput = () => { audio.currentTime = Number($('seek').value); lastFollow = -1; update(); };
$('speed').onchange = () => { audio.playbackRate = Number($('speed').value); update(); };
$('follow').onchange = () => { lastFollow = -1; update(); };
audio.addEventListener('loadedmetadata', () => {
  if (!ready || audio.currentSrc !== new URL(chapter.audio, location.href).href) return;
  if (Math.abs(audio.duration - chapter.duration) > 1) { ready = false; $('integrity').textContent = 'Audio duration differs from the recorded receipt. Regenerate and verify the inputs.'; $('integrity').classList.add('error'); storageStatus(); return; }
  loaded = true; audio.currentTime = pendingPosition; audio.playbackRate = Number($('speed').value);
  $('play').disabled = $('restart').disabled = $('seek').disabled = false; update(); status(pendingPosition ? 'Listening position restored. Press Play to continue.' : 'Ready to play.');
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
$('comment-selection').onpointerdown = event => event.preventDefault();
$('comment-selection').onclick = () => {
  if (!selected || store.blocked || !ready) return;
  pauseForWriting(); if (!store.state.draft) store.draft({ anchor: selected, body: '' });
  showComposer();
};
$('notes').oninput = () => { store.notes($('notes').value); storageStatus(); };
$('comment-body').oninput = () => { if (store.state.draft) store.draft({ ...store.state.draft, body: $('comment-body').value }); storageStatus(); };
$('dictate-notes').onclick = () => dictate('notes'); $('dictate-comment').onclick = () => dictate('comment');
$('save-comment').onclick = () => {
  if (dictation.state !== 'idle') return;
  try { if (store.saveComment()) { closeComposer(); renderComments(); } storageStatus(); }
  catch (error) { $('storage-status').textContent = error.message; }
};
$('back').onclick = () => { dictation.cancel(); closeComposer(); renderComments(); };
$('resume-draft').onclick = () => { pauseForWriting(); showComposer(); };
$('discard').onclick = () => {
  if (!confirm('Discard this unfinished draft? The saved comment, if any, will be kept.')) return;
  dictation.cancel(); if (store.write({ ...store.state, draft: null })) { closeComposer(); renderComments(); } storageStatus();
};
$('export').onclick = () => download(store.export(), `${data.bookId}-${chapter.id}.comments.json`);
$('recovery').onclick = () => download(store.recovery(), `${data.bookId}-${chapter.id}.recovery.json`);
window.addEventListener('storage', event => {
  if (event.key === store?.key || event.key === null) {
    dictation.cancel(); store.blocked = true; store.error = 'Another tab changed these notes. Export recovery data, then reload.'; storageStatus(); renderComments();
  }
});
window.addEventListener('pagehide', () => { savePosition(); dictation.cancel(); audio.pause(); });
window.addEventListener('beforeunload', event => { if (store?.dirty) { event.preventDefault(); event.returnValue = ''; } });
document.addEventListener('visibilitychange', () => { if (document.hidden) savePosition(); });
let initial = data.chapters[0].id;
try { const raw = storage.getItem(selectionKey); if (raw !== null) { const saved = JSON.parse(raw); if (!data.chapters.some(c => c.id === saved.chapterId)) throw Error('Saved chapter missing'); initial = saved.chapterId; } }
catch { selectionBlocked = true; }
void selectChapter(initial);
