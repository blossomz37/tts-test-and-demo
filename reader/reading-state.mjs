// Presentation preferences extend the existing backup record without changing its schema.
export const defaultPreferences = Object.freeze({ speed: 1, follow: true, focus: false, fontSize: 20, lineHeight: 1.6, width: 620, theme: 'light', readingFont: 'serif' });
export function readingPreferences(saved, systemDark = false) {
  return { ...defaultPreferences, theme: systemDark ? 'dark' : 'light', ...saved };
}

// Group verified word cues by source sentence. These ranges never supply audio timing
// or replace the source text, and all indexes remain native UTF-16 offsets.
export function sentenceCueAnchors(text, cues, Segmenter = globalThis.Intl?.Segmenter) {
  const boundaries = Segmenter
    ? Array.from(new Segmenter('en', { granularity: 'sentence' }).segment(text), s => ({ start: s.index, end: s.index + s.segment.length }))
    : Array.from(text.matchAll(/[\s\S]+?(?:[.!?…]+["'”’»)\]]*(?=\s|$)\s*|$)/gu), m => ({ start: m.index, end: m.index + m[0].length }));
  const segments = [];
  for (const boundary of boundaries) {
    const previous = segments.at(-1), preceding = previous && text.slice(previous.start, previous.end);
    // Segmenter can treat a manuscript's single line break as a sentence end.
    // Keep a continued sentence together while retaining real paragraph breaks.
    if (previous && !/[.!?…]+["'”’»)\]]*\s*$/u.test(preceding) && !/\r?\n[\t ]*\r?\n/u.test(preceding)) previous.end = boundary.end;
    else segments.push({ ...boundary });
  }
  let sentence = 0, firstCue = 0;
  return cues.map((cue, index) => {
    while (sentence < segments.length - 1 && cue.from >= segments[sentence].end) { sentence++; firstCue = index; }
    return firstCue;
  });
}

export function playbackAction(paused, ended, position) {
  return !paused ? 'Pause' : !ended && position > 0 ? 'Resume' : 'Play';
}
export function shouldFollowAudio({ follow, activeIndex, lastFollow, selectionCollapsed, editing }) {
  return follow && activeIndex >= 0 && activeIndex !== lastFollow && selectionCollapsed && !editing;
}
