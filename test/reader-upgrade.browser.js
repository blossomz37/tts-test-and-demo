// Run through playwright-cli run-code on the disposable reader-verification fixture only.
async (page) => {
  const check = (condition, message) => { if (!condition) throw Error(message); };
  check(await page.evaluate(() => window.CHAPTER_READER.bookId === 'reader-verification'), 'Use the disposable fixture, never a real book');
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
    window.__recognitions=[];
    class Recognition { static available=async()=>'available'; start(){window.__recognitions.push(this);this.onstart?.();} stop(){this.onend?.();} abort(){} }
    Recognition.prototype.processLocally=false;window.SpeechRecognition=Recognition;
    window.__speech=(text,final=true)=>window.__recognitions.at(-1).onresult({results:[Object.assign([{transcript:text}],{isFinal:final})]});
  });
  check(await page.evaluate(async()=>!Object.keys((await(await fetch('./api/session')).json()).records).some(k=>k.endsWith(':sidecar'))),'Prepare a fresh disposable fixture before running this test');
  await page.reload();
  const ready=()=>page.waitForFunction(()=>!document.getElementById('play').disabled);
  const saved=()=>page.waitForFunction(()=>document.getElementById('storage-status').textContent==='Saved to local database.');
  const select=async()=>page.evaluate(()=>{const words=document.querySelectorAll('#passage .word'),r=document.createRange();r.setStart(words[0].firstChild,0);r.setEnd(words[1].firstChild,words[1].textContent.length);const s=getSelection();s.removeAllRanges();s.addRange(r);document.dispatchEvent(new Event('selectionchange'));});
  await ready();await saved();await page.evaluate(()=>document.getElementById('audio').muted=true);
  await page.getByRole('button',{name:'Play narration',exact:true}).click();await page.waitForFunction(()=>document.getElementById('audio').currentTime>.4);
  await page.getByRole('button',{name:'Pause narration',exact:true}).click();await page.getByRole('button',{name:'Forward ten seconds',exact:true}).click();
  check(await page.evaluate(()=>document.getElementById('audio').currentTime>10),'Forward seek');
  await page.getByRole('button',{name:'Back ten seconds',exact:true}).click();
  await select();await page.getByRole('button',{name:'Listen from here',exact:true}).click();await page.waitForFunction(()=>!document.getElementById('audio').paused);
  await page.getByRole('button',{name:'Pause narration',exact:true}).click();
  await page.getByRole('textbox',{name:'General notes',exact:true}).fill('Database note\nSecond line');await saved();
  await page.getByRole('button',{name:'Dictate notes',exact:true}).click();await page.waitForFunction(()=>window.__recognitions.length===1);
  check(await page.evaluate(()=>window.__recognitions[0].processLocally===true),'Local recognition required');
  await page.evaluate(()=>{window.__speech('interim',false);window.__speech('Final words.');window.__speech('Final words.');});
  await page.getByRole('button',{name:'Stop dictation',exact:true}).click();await saved();
  check(await page.getByRole('textbox',{name:'General notes',exact:true}).inputValue()==='Database note\nSecond line Final words.','Dictation routing/deduplication');
  await select();await page.getByRole('button',{name:'Comment on selection',exact:true}).click();
  await page.getByRole('textbox',{name:'Comment draft',exact:true}).fill('Review this phrasing');await page.locator('#comment-category').selectOption('wording');await page.getByRole('button',{name:'Save comment',exact:true}).click();await saved();
  await page.getByRole('button',{name:'Resolve',exact:true}).click();await saved();check(await page.locator('.comment-card.resolved').count()===1,'Resolve comment');
  await page.getByRole('button',{name:'Reopen',exact:true}).click();await saved();
  await page.getByRole('button',{name:'Edit',exact:true}).click();await page.getByRole('textbox',{name:'Comment draft',exact:true}).fill('Pending edit retained');await page.getByRole('button',{name:'Back · keep draft',exact:true}).click();await saved();
  await page.getByRole('checkbox',{name:'Chapter reviewed',exact:true}).check();await saved();
  await page.getByRole('button',{name:'Bookmark position',exact:true}).click();await saved();
  await page.getByRole('button',{name:'Book tools',exact:true}).click();await page.getByText('Reading settings',{exact:true}).click();
  await page.getByRole('combobox',{name:'Speed',exact:true}).selectOption('1.5');await page.getByRole('combobox',{name:'Appearance',exact:true}).selectOption('dark');await page.getByRole('combobox',{name:'Text size',exact:true}).selectOption('22');await saved();
  await page.getByRole('button',{name:'Focus view',exact:true}).click();check(await page.locator('aside').isVisible()===false,'Focus hides notes');await saved();await page.getByRole('button',{name:'Exit focus',exact:true}).click();await saved();
  await page.getByText('Search & review this book',{exact:true}).click();await page.getByRole('searchbox',{name:'Search text and comments',exact:true}).fill('second passage');
  check(await page.locator('#book-results .result').count()===2,'Cross-chapter text search');
  await page.getByRole('searchbox',{name:'Search text and comments',exact:true}).fill('');await page.locator('#category-filter').selectOption('wording');check(await page.locator('#book-results .result').count()===1,'Category review filter');
  await page.getByText('Backups & exports',{exact:true}).click();
  const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Export revision brief',exact:true}).click();const downloaded=await downloadPromise;check(downloaded.suggestedFilename().endsWith('.md'),'Markdown export');
  const backupPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Back up whole book',exact:true}).click();check((await backupPromise).suggestedFilename().endsWith('.reader-backup.json'),'Book backup export');
  const backup=await page.evaluate(()=>fetch('./api/backup').then(r=>r.json()));
  await page.getByRole('textbox',{name:'General notes',exact:true}).fill('Newer note to replace');await saved();
  await page.locator('#restore-file').setInputFiles({name:'restore.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});await page.locator('#restore-preview').waitFor({state:'visible'});
  await page.getByRole('textbox',{name:'General notes',exact:true}).fill('Edit after preview');await saved();
  await page.getByRole('button',{name:'Restore this backup',exact:true}).click();await page.waitForFunction(()=>document.getElementById('action-status').textContent.includes('changed after preview'));
  await page.locator('#restore-file').setInputFiles({name:'restore-again.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});await page.waitForFunction(()=>document.getElementById('action-status').textContent.startsWith('Review the restore'));
  await page.getByRole('button',{name:'Restore this backup',exact:true}).click();await page.waitForFunction(()=>document.getElementById('action-status').textContent.startsWith('Backup restored.'));await saved();
  check((await page.getByRole('textbox',{name:'General notes',exact:true}).inputValue()).includes('Database note'),'Restore notes');check(await page.getByRole('button',{name:'Resume draft',exact:true}).isVisible(),'Restore draft');
  const browser=page.context().browser(), fresh=await browser.newContext(), other=await fresh.newPage();
  try {await other.goto(page.url());await other.waitForFunction(()=>!document.getElementById('play').disabled);await other.waitForFunction(()=>document.getElementById('storage-status').textContent==='Saved to local database.');
    check((await other.getByRole('textbox',{name:'General notes',exact:true}).inputValue()).includes('Database note'),'Fresh profile SQLite recovery');check(await other.locator('#theme').inputValue()==='dark','Fresh profile preferences');check(await other.getByRole('button',{name:'Resume draft',exact:true}).isVisible(),'Fresh profile drafts');
    await other.getByRole('textbox',{name:'General notes',exact:true}).fill('Other window wins');await other.waitForFunction(()=>document.getElementById('storage-status').textContent==='Saved to local database.');
    await page.getByRole('textbox',{name:'General notes',exact:true}).fill('Conflicting pending work');await page.waitForFunction(()=>document.getElementById('storage-status').textContent.includes('Another window'));
    check((await page.getByRole('textbox',{name:'General notes',exact:true}).inputValue())==='Conflicting pending work','Conflict retains typing');
  }finally{await fresh.close();}
  await page.setViewportSize({width:390,height:844});check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Narrow layout overflow');
  check(errors.length===0,`Page errors: ${errors.join('; ')}`);
  return {passed:true,flows:['real playback and seek','listen from selection','controlled local dictation','comments categories resolve drafts','bookmarks review','focus and preferences','book-wide search','Markdown and backup exports','previewed restore','fresh profile recovery','conflict recovery','narrow layout']};
}
