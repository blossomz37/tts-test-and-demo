import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ReaderDatabase } from '../reader/database.mjs';
import { SidecarStore, sidecarKey, positionKey } from '../reader/state.mjs';
import { preferencesKey, reviewKey, validateBackup, identity, markdownBrief } from '../reader/book-records.mjs';
import { anchor } from '../src/comments.mjs';
import { createReaderServer } from '../reader/serve.mjs';
import { hash } from '../reader/inputs.mjs';
const chapter={id:'chapter-01',title:'Chapter 1',source:{id:'chapter-01',text:'One 🪶 two.\nOne more.',sha256:hash('One 🪶 two.\nOne more.')},audioSha256:hash('audio'),narrationSha256:hash('narration'),duration:12};
const data={bookId:'book',title:'Test book',chapters:[chapter]};
function fullRecords(){
 const records={},storage={getItem:k=>records[k]??null,setItem:(k,v)=>records[k]=v};
 const store=new SidecarStore(storage,data.bookId,chapter);
 store.notes('First line\nSecond line');store.draft({anchor:anchor(chapter.source.text,0,3),body:'Saved comment',category:'pacing'});store.saveComment();store.draft({anchor:anchor(chapter.source.text,7,10),body:'Unfinished fixture draft'});
 records[positionKey(data.bookId,chapter)]=JSON.stringify({sourceSha256:chapter.source.sha256,audioSha256:chapter.audioSha256,time:6.5});
 records[preferencesKey(data.bookId)]=JSON.stringify({speed:1.5,follow:false,focus:true,fontSize:22,lineHeight:2.1,width:920,theme:'dark'});
 records[reviewKey(data.bookId,chapter)]=JSON.stringify({reviewed:true,bookmarks:[{id:'b',label:'Listen again',time:3}]});return records;
}
test('SQLite survives restart and portable backup recovers exact source, drafts, notes, progress and preferences',async()=>{
 const root=await mkdtemp(join(tmpdir(),'reader-db-'));let db,other;
 try{
  db=new ReaderDatabase(root,data);const records=fullRecords();assert.equal(db.save(records,0).revision,1);const backup=db.backup();db.close();db=new ReaderDatabase(root,data);assert.deepEqual(db.read().records,records);
  const second=join(root,'fresh');await mkdir(second);other=new ReaderDatabase(second,data);const preview=other.preview(backup);assert.equal(preview.incoming.comments,1);assert.equal(preview.incoming.drafts,1);other.save(backup.records,0,{restore:true});assert.deepEqual(other.read().records,records);
  const snapshots=await readdir(join(root,'notes','backups'));assert.equal(snapshots.length,1);
  const check=new DatabaseSync(join(root,'notes','backups',snapshots[0]),{readOnly:true});assert.equal(check.prepare('PRAGMA quick_check').get().quick_check,'ok');check.close();
 }finally{db?.close();other?.close();await rm(root,{recursive:true,force:true});}
});
test('SQLite rejects competing writes, foreign and stale backups and rolls back an interrupted record transaction',async()=>{
 const root=await mkdtemp(join(tmpdir(),'reader-db-'));let db;
 try{db=new ReaderDatabase(root,data);const records=fullRecords();db.save(records,0);const backup=db.backup();
  assert.throws(()=>db.save({},0),/Another window/);assert.throws(()=>db.preview({...backup,bookId:'other'}),/different book/);
  assert.throws(()=>db.preview({...backup,chapters:[{...backup.chapters[0],audioSha256:'new'}]}),/different book/);
  const bad={...records,[sidecarKey(data.bookId,chapter.id)]:JSON.stringify({...JSON.parse(records[sidecarKey(data.bookId,chapter.id)]),source:{...chapter.source,text:'changed'}})};assert.throws(()=>db.save(bad,1),/another source/);
  db.db.exec("CREATE TRIGGER fail_insert BEFORE INSERT ON records BEGIN SELECT RAISE(ABORT, 'disk failure fixture'); END;");
  assert.throws(()=>db.save(records,1),/disk failure/);assert.equal(db.read().revision,1);assert.deepEqual(db.read().records,records);
 }finally{db?.close();await rm(root,{recursive:true,force:true});}
});
test('Markdown export includes saved review context and excludes unfinished drafts',()=>{
 const records=fullRecords(), md=markdownBrief(data,records);assert.match(md,/Saved comment/);assert.match(md,/pacing/);assert.match(md,/First line\nSecond line/);assert.doesNotMatch(md,/Unfinished fixture draft/);assert.match(md,/Source offsets: 0–3/);
 assert.throws(()=>validateBackup(data,{format:'local-reader-backup',version:1,bookId:'book',chapters:identity(data),records:{alien:'{}'}}),/Unknown/);
});
test('loopback write API requires origin and token; restore preview binds content and database revision',async()=>{
 const root=await mkdtemp(join(tmpdir(),'reader-api-'));let server;
 try{
  const c={...chapter};for(const [field,value]of [['sourcePath',chapter.source.text],['narrationPath','narration'],['audioPath','audio'],['receiptPath','receipt']]){c[field]=join(root,field);await writeFile(c[field],value);}c.receiptSha256=hash('receipt');
  await writeFile(join(root,'inputs.json'),JSON.stringify({...data,chapters:[c]}));server=await createReaderServer(root);await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`,api=`${origin}/reader/api/`;
  const session=await(await fetch(api+'session')).json();const headers={'Content-Type':'application/json',Origin:origin,'X-Reader-Token':session.token};
  const post=(route,body,h=headers)=>fetch(api+route,{method:'POST',headers:h,body:JSON.stringify(body)});
  assert.equal((await post('save',{records:fullRecords(),revision:0},{...headers,Origin:'https://evil.example'})).status,403);
  assert.equal((await post('save',{records:{},revision:0},{...headers,'X-Reader-Token':'wrong'})).status,403);
  assert.equal((await fetch(origin+'/reader/notes/reader.sqlite')).status,404);
  assert.equal((await post('save',{records:fullRecords(),revision:0})).status,200);
  const backup=await(await fetch(api+'backup')).json();const preview=await(await post('preview',{backup})).json();assert.ok(preview.token);
  await post('save',{records:fullRecords(),revision:1});assert.equal((await post('restore',{token:preview.token})).status,409);
  const fresh=await(await post('preview',{backup})).json();assert.equal((await post('restore',{token:fresh.token})).status,200);assert.equal((await post('restore',{token:fresh.token})).status,400);
 }finally{if(server)await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true});}
});
test('pending browser recovery blocks new writes and is preserved until deliberate recovery',async()=>{
 const {DatabaseStorage}=await import('../reader/database-client.mjs');
 const pending=JSON.stringify({revision:1,records:fullRecords()}),disk=new Map([['chapter-reader:database-recovery:book',pending]]);
 const browser={getItem:k=>disk.get(k)??null,setItem:(k,v)=>disk.set(k,v)};
 const client=new DatabaseStorage(browser,data,{revision:2,records:{},token:'fixture',databasePath:'fixture'});
 assert.equal(client.blocked,true);assert.equal(client.pendingRecovery,pending);
 assert.throws(()=>client.setItem('key','value'),/Pending browser edits/);assert.equal(browser.getItem(client.recoveryKey),pending);
});
