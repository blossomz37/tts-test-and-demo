import { paragraphRanges } from './reading-state.mjs';

// Layout decorations live beside the source DOM so selection/copy/export offsets
// remain exact. The same notes controls move into a native dialog on small screens.
export function mountReadingLayout({ rangeFor, pause, cancelDictation }) {
  const $ = id => document.getElementById(id), root = document.documentElement;
  const transport = document.querySelector('.transport'), toolbar = $('reading-toolbar');
  const panel = $('notes-panel'), dialog = $('notes-dialog'), workspace = document.querySelector('.workspace');
  const narrow = matchMedia('(max-width: 1000px)'), phone = matchMedia('(max-width: 760px)');
  let paragraphs = [], queued = false, layoutDirty = false;

  function location() {
    if (!paragraphs.length) { $('paragraph-location').textContent = ''; return; }
    const frameTop = document.querySelector('.passage-frame').getBoundingClientRect().top;
    const visibleTop = Math.max(0, toolbar.getBoundingClientRect().bottom);
    let current = paragraphs[0];
    for (const paragraph of paragraphs) {
      if (paragraph.top + frameTop > visibleTop + 4) break;
      current = paragraph;
    }
    $('paragraph-location').textContent = `Paragraph ${current.number} of ${paragraphs.length}`;
    for (const paragraph of paragraphs) paragraph.label.classList.toggle('in-view', paragraph === current);
  }
  function measure() {
    const transportHeight = phone.matches ? 0 : Math.ceil(transport.getBoundingClientRect().height);
    root.style.setProperty('--transport-height', `${transportHeight}px`);
    root.style.setProperty('--reading-toolbar-height', `${Math.ceil(toolbar.getBoundingClientRect().height)}px`);
    const frameTop = document.querySelector('.passage-frame').getBoundingClientRect().top;
    for (const paragraph of paragraphs) {
      const rect = paragraph.range?.getClientRects()[0];
      paragraph.label.hidden = !rect;
      paragraph.top = rect ? rect.top - frameTop : 0;
      paragraph.label.style.top = `${paragraph.top}px`;
    }
    location();
  }
  function schedule(dirty = false) {
    layoutDirty ||= dirty;
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      if (layoutDirty) { layoutDirty = false; measure(); } else location();
    });
  }
  function dialogMode() {
    const useDialog = narrow.matches || document.body.classList.contains('focus-view');
    if (useDialog && panel.parentElement !== dialog) dialog.append(panel);
    if (!useDialog && panel.parentElement === dialog) {
      if (dialog.open) dialog.close();
      workspace.append(panel);
    }
    if (document.body.classList.contains('notes-in-dialog') !== useDialog) document.body.classList.toggle('notes-in-dialog', useDialog);
    schedule(true);
  }
  function close() { if (dialog.open) dialog.close(); }
  function reveal(target) {
    const container = dialog.open ? dialog : panel, bounds = container.getBoundingClientRect();
    const top = bounds.top + (dialog.open ? panel.querySelector('.notes-dialog-heading').offsetHeight + 8 : 4);
    const bottom = bounds.bottom - 8, rect = target.getBoundingClientRect();
    if (rect.top < top || rect.height > bottom - top) container.scrollTop += rect.top - top;
    else if (rect.bottom > bottom) container.scrollTop += rect.bottom - bottom;
  }
  function show(target = panel) {
    pause(); dialogMode();
    if (panel.parentElement === dialog && !dialog.open) {
      dialog.showModal(); document.body.classList.add('notes-open');
      $('notes-toggle').setAttribute('aria-expanded', 'true');
    }
    target.focus({ preventScroll: true });
    if (target !== panel) reveal(target);
  }
  $('notes-toggle').onclick = () => show();
  $('close-notes').onclick = close;
  dialog.addEventListener('close', () => {
    cancelDictation(); document.body.classList.remove('notes-open');
    $('notes-toggle').setAttribute('aria-expanded', 'false');
    if (document.body.classList.contains('notes-in-dialog')) $('notes-toggle').focus({ preventScroll: true });
  });
  const resize = new ResizeObserver(() => schedule(true));
  for (const element of [transport, toolbar, $('passage')]) resize.observe(element);
  new MutationObserver(dialogMode).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  narrow.addEventListener('change', dialogMode); phone.addEventListener('change', () => schedule(true));
  window.addEventListener('resize', () => schedule(true));
  window.addEventListener('scroll', () => schedule(), { passive: true });
  document.fonts?.ready.then(() => schedule(true));
  dialogMode();
  return {
    show, close, reveal,
    refresh: () => schedule(true),
    setChapter(text) {
      paragraphs = paragraphRanges(text).map(paragraph => {
        const label = document.createElement('span'); label.textContent = paragraph.number;
        label.title = `Paragraph ${paragraph.number}`;
        return { ...paragraph, label, range: rangeFor(paragraph), top: 0 };
      });
      $('paragraph-numbers').replaceChildren(...paragraphs.map(paragraph => paragraph.label));
      panel.scrollTop = dialog.scrollTop = 0; schedule(true);
    }
  };
}
