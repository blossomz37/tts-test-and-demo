import { setButtonLabel } from './icon-buttons.mjs';
import { anchor, matches, sourceIdentity, makeComment, reviseComment, snapToWords, relativeTime } from './comments.mjs';
import { Dictation, appendTranscript } from './dictation.mjs';
export async function setupComments({ text, stopOtherAudio, getGeneralNotes = () => '' }) {
  const $ = id => document.getElementById(id), source = await sourceIdentity(text);
  const key = 'tts-demo:sidecar:v1';
  let selected, draft = null, comments = [], blocked = false;
  const status = message => { $('comment-status').textContent = message; };
  let noticeTimer;
  const notice = message => { clearTimeout(noticeTimer); $('sidecar-status').textContent = message; noticeTimer = setTimeout(() => { $('sidecar-status').textContent = ''; }, 4000); };
  try {
    const saved = JSON.parse(localStorage.getItem(key) || 'null');
    if (saved) {
      if (saved.schemaVersion !== 1 || saved.source?.sha256 !== source.sha256 || !Array.isArray(saved.comments) || saved.comments.some(c => !matches(text, c.anchor) || typeof c.body !== 'string') || (saved.draft && (!matches(text, saved.draft.anchor) || typeof saved.draft.body !== 'string' || (saved.draft.commentId && !saved.comments.some(c => c.id === saved.draft.commentId))))) throw Error('Saved comments belong to another passage or cannot be read. Existing storage has been preserved.');
      comments = saved.comments; draft = saved.draft;
    }
  } catch (error) { blocked = true; status(error.message); }
  const payload = () => ({ schemaVersion:1, source, offsetUnit:'UTF-16 code units', comments, draft });
  function persist() {
    if (blocked) { status('Existing sidecar storage could not be loaded. It has been preserved.'); return false; }
    try { localStorage.setItem(key, JSON.stringify(payload())); return true; }
    catch { status('Could not save locally. Keep this page open and copy your comment.'); return false; }
  }
  function rangeFor(target) {
    const walker = document.createTreeWalker($('passage'), NodeFilter.SHOW_TEXT), range = document.createRange();
    let node, offset = 0;
    while ((node = walker.nextNode())) {
      const next = offset + node.length;
      if (target.start >= offset && target.start < next) range.setStart(node, target.start - offset);
      if (target.end > offset && target.end <= next) { range.setEnd(node, target.end - offset); return range; }
      offset = next;
    }
  }
  function mark(target) {
    if (!globalThis.CSS?.highlights) return;
    CSS.highlights.delete('comment-target');
    if (target) CSS.highlights.set('comment-target', new Highlight(rangeFor(target)));
  }
  function showComposer() {
    $('comment-inspector').hidden = false; $('comment-composer').hidden = false;
    $('comment-heading').textContent = draft.commentId ? 'Edit comment' : 'Comment on selection';
    setButtonLabel(discard, draft.commentId ? 'Delete comment' : 'Discard draft');
    $('resume-comment').hidden = true;
    $('comment-quote').textContent = draft.anchor.quote; $('comment-body').value = draft.body;
    mark(draft.anchor); $('comment-body').focus();
  }
  function render() {
    $('comment-inspector').hidden = !comments.length && !draft;
    if (globalThis.CSS?.highlights) CSS.highlights.set('saved-comments', new Highlight(...comments.map(c => rangeFor(c.anchor))));
    $('sidecar').hidden = comments.length === 0;
    $('comment-list').replaceChildren(...comments.map(comment => {
      const card = document.createElement('article'); card.className = 'comment-card'; card.dataset.commentId = comment.id; card.tabIndex = -1;
      const quote = document.createElement('blockquote'); quote.textContent = comment.anchor.quote;
      const body = document.createElement('p'); body.textContent = comment.body;
      const when = document.createElement('time'); when.className = 'comment-time'; when.dateTime = comment.updatedAt || comment.createdAt;
      when.textContent = (comment.updatedAt ? 'Edited ' : '') + relativeTime(comment.updatedAt || comment.createdAt); when.title = new Date(when.dateTime).toLocaleString();
      const locate = document.createElement('button'); setButtonLabel(locate, 'Show passage');
      locate.onclick = () => { activate(comment); mark(comment.anchor); $('passage').scrollIntoView({ behavior:'smooth', block:'center' }); };
      const edit = document.createElement('button'); setButtonLabel(edit, 'Edit comment');
      edit.onclick = () => {
        stopOtherAudio(); dictation.cancel();
        if (draft && draft.commentId !== comment.id) { showComposer(); status('Finish the open comment first. Your changes are preserved.'); return; }
        draft ??= { commentId:comment.id, anchor:comment.anchor, body:comment.body };
        showComposer(); if (persist()) status('Edit or dictate, then save your changes.');
      };
      const actions = document.createElement('div'); actions.className = 'controls'; actions.append(edit, locate);
      card.append(quote, body, when, actions); return card;
    }));
  }
  function activate(comment) {
    for (const card of $('comment-list').children) card.classList.toggle('selected', card.dataset.commentId === comment.id);
    mark(comment.anchor);
  }
  $('passage').addEventListener('click', event => {
    if (!getSelection().isCollapsed) return;
    const linked = comments.filter(comment => [...rangeFor(comment.anchor).getClientRects()].some(rect => event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom));
    if (!linked.length) return;
    // When anchors overlap, successive clicks cycle through the linked comments.
    const active = $('comment-list').querySelector('.selected')?.dataset.commentId;
    const comment = linked[(linked.findIndex(c => c.id === active) + 1) % linked.length];
    activate(comment);
    const card = [...$('comment-list').children].find(c => c.dataset.commentId === comment.id);
    card.focus({ preventScroll:true }); card.scrollIntoView({ behavior:'smooth', block:'nearest' });
  });
  const dictation = new Dictation({ Recognition:window.SpeechRecognition || window.webkitSpeechRecognition,
    append: words => { if (!draft) return; draft.body = appendTranscript($('comment-body').value, words); $('comment-body').value = draft.body; persist(); },
    emit: event => {
      if (event.interim !== undefined) $('comment-interim').textContent = event.interim;
      if (event.message) status(event.message.replace('your notes', 'your comment').replace('Notes saved on this device.', 'Review your comment, then save it.'));
      const active = event.state !== 'idle';
      setButtonLabel($('comment-dictate'), event.state === 'preparing' ? 'Cancel setup' : active ? 'Stop dictation' : 'Dictate comment');
      $('comment-dictate').setAttribute('aria-pressed', String(active));
      $('comment-dictate').disabled = event.state === 'stopping';
      $('save-comment').disabled = active || blocked;
    }
  });
  document.addEventListener('selectionchange', () => {
    const selection = getSelection(); selected = null;
    if (selection.rangeCount && !selection.isCollapsed) {
      const range = selection.getRangeAt(0);
      if ($('passage').contains(range.startContainer) && $('passage').contains(range.endContainer)) {
        const before = document.createRange(); before.selectNodeContents($('passage')); before.setEnd(range.startContainer, range.startOffset);
        try { const snapped = snapToWords(text, before.toString().length, before.toString().length + range.toString().length); selected = anchor(text, snapped.start, snapped.end); } catch {}
      }
    }
    $('comment-selection').disabled = !selected;
  });
  // Preserve the selection while the pointer moves focus to its action button.
  $('comment-selection').onpointerdown = event => event.preventDefault();
  $('comment-selection').onclick = () => {
    if (!selected) return;
    stopOtherAudio(); dictation.cancel();
    if (draft) { showComposer(); status('Finish this comment first. Your draft is preserved.'); return; }
    draft = { anchor:selected, body:'' }; showComposer(); if (persist()) status('Type or dictate, then save your comment.');
  };
  $('comment-body').oninput = () => { draft.body = $('comment-body').value; persist(); };
  $('comment-dictate').onclick = () => { if (dictation.state !== 'idle') dictation.stop(); else { stopOtherAudio(); dictation.start(); } };
  $('save-comment').onclick = () => {
    if (!draft || dictation.state !== 'idle') return;
    try {
      const oldDraft = draft, oldComments = comments;
      let comment;
      if (draft.commentId) {
        const original = comments.find(c => c.id === draft.commentId);
        if (!original) throw Error('This comment is no longer available. Your draft is preserved.');
        comment = reviseComment(source, original, draft.body);
        comments = comments.map(c => c.id === comment.id ? comment : c);
      } else {
        comment = makeComment(source, draft.anchor, draft.body);
        comments = [...comments, comment];
      }
      draft = null;
      if (!persist()) { comments = oldComments; draft = oldDraft; return; }
      render(); status(''); notice(oldDraft.commentId ? 'Changes saved.' : 'Comment saved.'); $('resume-comment').hidden = true; $('comment-composer').hidden = true; $('general-notes').hidden = false; mark(null);
      [...$('comment-list').children].find(card => card.dataset.commentId === comment.id)?.focus();
    } catch (error) { status(error.message); }
  };
  $('cancel-comment').onclick = () => {
    dictation.cancel(); persist(); $('comment-composer').hidden = true; $('general-notes').hidden = false; mark(null);
    $('resume-comment').hidden = !draft; render(); $('notes').focus();
  };
  const discard = document.createElement('button'); setButtonLabel(discard, 'Discard draft');
  $('comment-composer').querySelector('.controls').append(discard);
  discard.onclick = () => {
    if (!draft) return;
    if (draft.commentId && !window.confirm('Delete this comment and its unsaved changes? This cannot be undone.')) return;
    dictation.cancel();
    const oldDraft = draft, oldComments = comments;
    if (draft.commentId) comments = comments.filter(c => c.id !== draft.commentId);
    draft = null;
    if (!persist()) { draft = oldDraft; comments = oldComments; return; }
    $('comment-composer').hidden = true; $('general-notes').hidden = false; $('resume-comment').hidden = true; mark(null); render(); status(''); if (oldDraft.commentId) notice('Comment deleted.'); $('notes').focus();
  };
  const resume = document.createElement('button'); resume.id = 'resume-comment'; setButtonLabel(resume, 'Resume comment'); resume.hidden = true;
  $('general-notes').append(resume); resume.onclick = () => { stopOtherAudio(); showComposer(); resume.hidden = true; };
  const exportSidecar = () => {
    const notes = getGeneralNotes();
    const exported = {
      ...payload(), schemaVersion:2, draft:undefined,
      comments: [
        ...comments.map(comment => ({ ...comment, type:'selection' })),
        ...(notes.trim() ? [{ id:'general-notes', type:'general', sourceSha256:source.sha256, anchor:null, body:notes }] : [])
      ]
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(exported, null, 2) + '\n'], { type:'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'apothecary.comments.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  $('export-comments').onclick = exportSidecar;
  window.addEventListener('pagehide', () => dictation.cancel());
  render(); if (draft) showComposer();
  return { cancel: () => dictation.cancel() };
}
