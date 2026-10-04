// Playback-only acceptance check. Use a generated disposable reader and its own database.
// For editing, migration and recovery flows use reader-upgrade.browser.js.
async (page) => {
  const check=(ok,message)=>{if(!ok)throw Error(message);};
  const data=await page.evaluate(()=>window.CHAPTER_READER);
  check(data.bookId==='reader-verification','Use a disposable reader-verification book');
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.evaluate(()=>document.getElementById('audio').muted=true);
  for(const chapter of data.chapters){
    await page.locator('#chapter').selectOption(chapter.id);
    await page.waitForFunction(id=>document.getElementById('chapter-title').textContent===window.CHAPTER_READER.chapters.find(c=>c.id===id).title&&!document.getElementById('play').disabled,chapter.id);
    check(await page.locator('#passage').textContent()===chapter.source.text,`Exact source ${chapter.id}`);
    for(const time of [chapter.duration*.7,chapter.duration*.2,0]){
      await page.locator('#seek').evaluate((el,t)=>{el.value=t;el.dispatchEvent(new Event('input'));},time);
      check(await page.evaluate(({id,time})=>{
        const c=window.CHAPTER_READER.chapters.find(c=>c.id===id),a=document.getElementById('audio');
        const expected=c.cues.filter(w=>time>=w.start&&time<w.displayEnd).map(w=>String(w.from));
        return Math.abs(a.currentTime-time)<.1&&JSON.stringify([...document.querySelectorAll('.word.current')].map(el=>el.dataset.from))===JSON.stringify(expected);
      },{id:chapter.id,time}),`Clock-driven highlights ${chapter.id} at ${time}`);
    }
    await page.getByRole('button',{name:'Play narration',exact:true}).click();await page.waitForFunction(()=>document.getElementById('audio').currentTime>.3);
    await page.getByRole('button',{name:'Pause narration',exact:true}).click();
  }
  check(errors.length===0,errors.join('; '));return{chapters:data.chapters.length,exactSource:true,forwardAndBackwardHighlights:true,realPlayback:true};
}
