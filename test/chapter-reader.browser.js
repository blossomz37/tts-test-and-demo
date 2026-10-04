// Run through playwright-cli run-code in a dedicated test browser session.
// SpeechRecognition is controlled: this test never starts a real microphone.
async (page) => {
  const check = (condition, message) => { if (!condition) throw Error(message); };
  const prefix = await page.evaluate(() => `chapter-reader:v1:${encodeURIComponent(window.CHAPTER_READER.bookId)}:`);
  const original = await page.evaluate(prefix => Object.entries(localStorage).filter(([k]) => k.startsWith(prefix)), prefix);
  await page.addInitScript(() => {
    window.__recognitions = [];
    class Recognition {
      static available = async () => 'available';
      start() { window.__recognitions.push(this); this.onstart?.(); }
      stop() { this.onend?.(); }
      abort() { this.aborted = true; }
    }
    Recognition.prototype.processLocally = false;
    window.SpeechRecognition = Recognition;
    window.__speech = (text, final = true) => {
      const r = window.__recognitions.at(-1);
      r.onresult({ results: [Object.assign([{ transcript: text }], { isFinal: final })] });
    };
  });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  try {
    await page.evaluate(prefix => { for (const k of Object.keys(localStorage)) if (k.startsWith(prefix)) localStorage.removeItem(k); }, prefix);
    await page.reload(); await page.waitForFunction(() => !document.getElementById('play').disabled);
    check(await page.evaluate(() => window.__recognitions.length === 0), 'Microphone must not start automatically');
    await page.evaluate(() => { document.getElementById('audio').muted = true; });
    await page.getByRole('button', { name: 'Play narration', exact: true }).click();
    await page.waitForFunction(() => document.getElementById('audio').currentTime > .5);
    await page.getByRole('button', { name: 'Pause narration', exact: true }).click();
    const paused = await page.evaluate(() => document.getElementById('audio').currentTime);
    await page.waitForTimeout(200);
    check(await page.evaluate(t => document.getElementById('audio').currentTime === t, paused), 'Pause must freeze the audio clock');
    const seekTime = await page.evaluate(() => {
      const c = window.CHAPTER_READER.chapters[0], w = c.cues[200], t = (w.start + w.displayEnd) / 2;
      const seek = document.getElementById('seek'); seek.value = t; seek.dispatchEvent(new Event('input')); return t;
    });
    await page.waitForFunction(t => Math.abs(document.getElementById('audio').currentTime - t) < .1, seekTime);
    check(await page.evaluate(() => {
      const c = window.CHAPTER_READER.chapters[0], t = document.getElementById('audio').currentTime;
      const expected = c.cues.filter(w => t >= w.start && t < w.displayEnd).map(w => String(w.from));
      return JSON.stringify([...document.querySelectorAll('.current')].map(e => e.dataset.from)) === JSON.stringify(expected);
    }), 'Highlights must match audio.currentTime after seeking while paused');
    await page.getByRole('combobox', { name: 'Speed', exact: true }).selectOption('1.5');
    await page.getByRole('button', { name: 'Play narration', exact: true }).click();
    await page.waitForFunction(t => document.getElementById('audio').currentTime > t + .5, seekTime);
    check(await page.evaluate(() => document.getElementById('audio').playbackRate === 1.5), 'Playback speed did not change');
    await page.getByRole('combobox', { name: 'Chapter', exact: true }).selectOption('chapter-02');
    await page.waitForFunction(() => !document.getElementById('play').disabled);
    check(await page.evaluate(() => document.getElementById('audio').paused && document.querySelectorAll('audio').length === 1), 'Chapter switch must stop the previous source');
    const count = await page.evaluate(() => window.CHAPTER_READER.chapters.length);
    for (let i = 0; i < count; i++) {
      const id = `chapter-${String(i + 1).padStart(2, '0')}`;
      await page.getByRole('combobox', { name: 'Chapter', exact: true }).selectOption(id);
      await page.waitForFunction(() => !document.getElementById('play').disabled);
      check(await page.evaluate(i => {
        const c = window.CHAPTER_READER.chapters[i], a = document.getElementById('audio');
        return document.getElementById('passage').textContent === c.source.text && Math.abs(a.duration - c.duration) < .1 && a.seekable.length > 0 && document.querySelectorAll('.word').length === c.cues.length;
      }, i), `Chapter ${i + 1}: text, media or cues differ`);
    }
    await page.getByRole('combobox', { name: 'Chapter', exact: true }).selectOption('chapter-01');
    await page.waitForFunction(() => !document.getElementById('play').disabled);
    check(await page.evaluate(t => document.getElementById('audio').currentTime >= t, seekTime), 'Chapter position not restored');
    await page.getByRole('checkbox', { name: 'Follow audio' }).uncheck();
    await page.evaluate(() => { window.scrollTo(0, 0); const s = document.getElementById('seek'), cue = window.CHAPTER_READER.chapters[0].cues[900]; s.value = (cue.start + cue.displayEnd) / 2; s.dispatchEvent(new Event('input')); });
    await page.waitForTimeout(100); check(await page.evaluate(() => scrollY < 10), 'Follow off must not scroll');
    await page.getByRole('checkbox', { name: 'Follow audio' }).check();
    check(await page.evaluate(() => scrollY > 100), 'Follow on should bring the current passage into view');
    await page.getByRole('checkbox', { name: 'Follow audio' }).uncheck();
    await page.getByRole('textbox', { name: 'General notes', exact: true }).fill('BROWSER CHECK\nSecond line.');
    await page.getByRole('button', { name: 'Play narration', exact: true }).click();
    await page.getByRole('button', { name: 'Dictate notes', exact: true }).click();
    await page.waitForFunction(() => window.__recognitions.length === 1);
    check(await page.evaluate(() => document.getElementById('audio').paused && window.__recognitions[0].processLocally === true), 'Dictation must pause playback and request local recognition');
    await page.evaluate(() => { window.__speech('interim words', false); });
    check(!(await page.getByRole('textbox', { name: 'General notes', exact: true }).inputValue()).includes('interim'), 'Interim speech leaked into notes');
    await page.evaluate(() => { window.__speech('Final note.'); window.__speech('Final note.'); });
    check((await page.getByRole('textbox', { name: 'General notes', exact: true }).inputValue()) === 'BROWSER CHECK\nSecond line. Final note.', 'Final result duplicated or typed text lost');
    await page.getByRole('button', { name: 'Stop dictation', exact: true }).click();
    await page.evaluate(() => {
      const words = document.querySelectorAll('.word'), r = document.createRange(); r.setStart(words[0].firstChild, 1); r.setEnd(words[1].firstChild, 2); getSelection().removeAllRanges(); getSelection().addRange(r);
    });
    await page.getByRole('button', { name: 'Comment on selection', exact: true }).click();
    await page.getByRole('textbox', { name: 'Comment draft', exact: true }).fill('BROWSER COMMENT');
    await page.getByRole('button', { name: 'Dictate comment', exact: true }).click();
    await page.waitForFunction(() => window.__recognitions.length === 2);
    await page.evaluate(() => { window.__speech('Comment final.'); window.__speech('Comment final.'); });
    await page.getByRole('button', { name: 'Stop dictation', exact: true }).click();
    check((await page.getByRole('textbox', { name: 'Comment draft', exact: true }).inputValue()) === 'BROWSER COMMENT Comment final.', 'Comment dictation routed incorrectly');
    await page.getByRole('button', { name: 'Back · keep draft' }).click();
    await page.reload(); await page.waitForFunction(() => !document.getElementById('play').disabled);
    await page.getByRole('button', { name: 'Resume draft' }).click();
    check((await page.getByRole('textbox', { name: 'Comment draft', exact: true }).inputValue()).includes('Comment final.'), 'Draft did not recover');
    await page.getByRole('button', { name: 'Save comment', exact: true }).click();
    const key = `${prefix}chapter-01:sidecar`;
    const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
    check(saved.comments[0].anchor.quote === saved.source.text.slice(saved.comments[0].anchor.start, saved.comments[0].anchor.end), 'Anchor no longer exact');
    check(saved.comments[0].anchor.start === 0 && saved.comments[0].anchor.quote.endsWith('streets'), 'Whole-word snapping failed');
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByRole('textbox', { name: 'Comment draft', exact: true }).fill('BROWSER EDIT');
    const exported = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export chapter notes' }).click();
    const file = await exported; await file.saveAs('output/playwright/chapter-reader-export.json');
    check(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).comments[0].body === 'BROWSER COMMENT Comment final.', key), 'Editing changed the saved comment before Save');
    await page.getByRole('button', { name: 'Save comment', exact: true }).click();
    check(await page.evaluate(({ key, id }) => JSON.parse(localStorage.getItem(key)).comments[0].id === id, { key, id: saved.comments[0].id }), 'Edit replaced comment identity');
    await page.evaluate(() => { window.confirm = () => false; }); await page.getByRole('button', { name: 'Delete', exact: true }).click();
    check(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).comments.length === 1, key), 'Cancelled deletion removed comment');
    await page.evaluate(() => { window.confirm = () => true; }); await page.getByRole('button', { name: 'Delete', exact: true }).click();
    check(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).comments.length === 0, key), 'Confirmed deletion failed');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => window.scrollTo(0, 0));
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Narrow layout overflows');
    await page.setViewportSize({ width: 1400, height: 1000 });
    check(errors.length === 0, `Browser exceptions: ${errors.join('; ')}`);
    const result = { chapters: count, playback: true, wordHighlighting: true, seekSpeedFollow: true, commentsDraftsExport: true, controlledDictation: true, microphoneTested: false, narrowLayout: true, errors };
    await page.evaluate(result => { window.__readerCheckResult = result; }, result);
    return result;
  } finally {
    await page.evaluate(({ prefix, original }) => { for (const k of Object.keys(localStorage)) if (k.startsWith(prefix)) localStorage.removeItem(k); for (const [k, v] of original) localStorage.setItem(k, v); }, { prefix, original });
  }
}
