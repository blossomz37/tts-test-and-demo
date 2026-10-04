import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { request } from 'node:http';
import { ReaderDatabase } from '../reader/database.mjs';
import { SidecarStore, sidecarKey, positionKey } from '../reader/state.mjs';
import { preferencesKey, reviewKey, validateBackup, validatePreferences, identity, markdownBrief } from '../reader/book-records.mjs';
import { readingPreferences } from '../reader/reading-state.mjs';
import { anchor } from '../src/comments.mjs';
import { createReaderServer, normalizeTailscaleOrigin } from '../reader/serve.mjs';
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
test('new reading defaults respect system theme only when there is no saved choice, and retain legacy settings',()=>{
 const defaults=readingPreferences(null,true);assert.equal(defaults.theme,'dark');assert.equal(defaults.readingFont,'serif');assert.equal(defaults.fontSize,20);assert.equal(defaults.lineHeight,1.6);assert.equal(defaults.width,620);validatePreferences(defaults);
 const legacy=JSON.parse(fullRecords()[preferencesKey(data.bookId)]);validatePreferences(legacy);
 assert.deepEqual(readingPreferences(legacy),{...legacy,readingFont:'serif'});
 assert.equal(readingPreferences({...legacy,theme:'light'},true).theme,'light');
 for(const fontSize of [16,19,22,25])for(const lineHeight of [1.5,1.8,2.1])validatePreferences({...legacy,fontSize,lineHeight});
 assert.throws(()=>validatePreferences({...defaults,readingFont:'decorative'}),/Invalid reading/);
 assert.throws(()=>validatePreferences({...defaults,readingFont:null}),/Invalid reading/);
});
test('serif and sans preferences round trip through the existing portable backup schema',async()=>{
 const root=await mkdtemp(join(tmpdir(),'reader-appearance-'));let db,restored;
 try{
  db=new ReaderDatabase(root,data);const second=join(root,'restored');await mkdir(second);restored=new ReaderDatabase(second,data);
  for(const readingFont of ['serif','sans']){
   const prefs={...readingPreferences(null,true),readingFont},records={...fullRecords(),[preferencesKey(data.bookId)]:JSON.stringify(prefs)};
   db.save(records,db.read().revision);const backup=db.backup();validateBackup(data,backup);assert.equal(backup.version,1);
   restored.preview(backup);restored.save(backup.records,restored.read().revision,{restore:true});assert.deepEqual(restored.read().records,records);
   assert.deepEqual(JSON.parse(restored.read().records[preferencesKey(data.bookId)]),prefs);
  }
 }finally{db?.close();restored?.close();await rm(root,{recursive:true,force:true});}
});
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

test('Tailscale configuration accepts only an explicit HTTPS device origin', () => {
 assert.equal(normalizeTailscaleOrigin(undefined), '');
 assert.equal(normalizeTailscaleOrigin('https://reader.example-tail.ts.net/'), 'https://reader.example-tail.ts.net');
 assert.equal(normalizeTailscaleOrigin('https://reader.example-tail.ts.net:8443'), 'https://reader.example-tail.ts.net:8443');
 for (const value of ['', null, 'http://reader.example-tail.ts.net', 'https://evil.example',
  'https://*.example-tail.ts.net', 'https://reader.example-tail.ts.net.evil.example',
  'https://reader.example-tail.ts.net:0', 'https://user:pass@reader.example-tail.ts.net',
  'https://reader.example-tail.ts.net/reader/', 'https://reader.example-tail.ts.net?query',
  'https://reader.example-tail.ts.net#fragment']) assert.throws(() => normalizeTailscaleOrigin(value), /tailscale-origin/);
});

test('private proxy access retains exact Host, Origin, token, file and range boundaries', async () => {
 const root = await mkdtemp(join(tmpdir(), 'reader-tailscale-'));
 let server;
 try {
  const c = { ...chapter, audioPath: join(root, 'recording.mp3') };
  await writeFile(c.audioPath, 'audio');
  await writeFile(join(root, 'inputs.json'), JSON.stringify({ ...data, chapters: [c] }));
  await writeFile(join(root, 'index.html'), '<!doctype html>reader');
  const remote = 'https://reader.example-tail.ts.net';
  const call = (path, headers = {}, body) => new Promise((resolve, reject) => {
   const req = request({ hostname: '127.0.0.1', port: server.address().port, path,
    method: body === undefined ? 'GET' : 'POST', headers }, res => {
    const chunks = []; res.on('data', chunk => chunks.push(chunk));
    res.on('error', reject); res.on('end', () => resolve({ status: res.statusCode,
     headers: res.headers, text: Buffer.concat(chunks).toString() }));
   });
   req.on('error', reject); req.end(body === undefined ? undefined : JSON.stringify(body));
  });
  server = await createReaderServer(root);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  assert.equal((await call('/reader/', { Host: new URL(remote).host })).status, 403);
  let fingerprint = JSON.parse((await call('/reader/api/identity')).text).fingerprint;
  await new Promise(r => server.close(r)); server = null;

  for (const tailscaleOrigin of [remote, `${remote}:8443`]) {
   server = await createReaderServer(root, { tailscaleOrigin });
   await new Promise(r => server.listen(0, '127.0.0.1', r));
   const local = `http://127.0.0.1:${server.address().port}`;
   const host = new URL(tailscaleOrigin).host, proxy = { Host: host, Origin: tailscaleOrigin };
   const localSession = JSON.parse((await call('/reader/api/session')).text);
   const remoteSession = JSON.parse((await call('/reader/api/session', proxy)).text);
   assert.deepEqual(remoteSession, localSession);
   const identity = JSON.parse((await call('/reader/api/identity', proxy)).text);
   assert.notEqual(identity.fingerprint, fingerprint); fingerprint = identity.fingerprint;
   assert.equal((await call('/reader/', proxy)).status, 200);
   const audio = await call('/mp3/chapter-01.mp3', { ...proxy, Range: 'bytes=1-3' });
   assert.equal(audio.status, 206); assert.equal(audio.text, 'udi');
   assert.equal(audio.headers['content-range'], 'bytes 1-3/5');
   for (const path of ['/reader/inputs.json', '/reader/notes/reader.sqlite', '/reader/history/index.html'])
    assert.equal((await call(path, proxy)).status, 404);
   for (const headers of [
    { ...proxy, Host: 'evil.example' },
    { ...proxy, Host: `${host}.evil.example`, 'X-Forwarded-Host': host, 'X-Forwarded-Proto': 'https' },
    { ...proxy, Host: new URL(local).host },
    { ...proxy, Origin: local },
    { ...proxy, Origin: 'https://evil.example' },
    { ...proxy, 'Sec-Fetch-Site': 'cross-site' },
    { ...proxy, Host: `${new URL(remote).hostname}:8444` }
   ]) assert.equal((await call('/reader/api/session', headers)).status, 403);
   const headers = { ...proxy, 'Content-Type': 'application/json', 'X-Reader-Token': remoteSession.token };
   const body = { records: fullRecords(), revision: remoteSession.revision };
   assert.equal((await call('/reader/api/save', { ...headers, 'X-Reader-Token': 'wrong' }, body)).status, 403);
   const withoutOrigin = { ...headers }; delete withoutOrigin.Origin;
   assert.equal((await call('/reader/api/save', withoutOrigin, body)).status, 403);
   assert.equal((await call('/reader/api/save', { ...headers, Origin: 'https://evil.example' }, body)).status, 403);
   assert.equal((await call('/reader/api/save', headers, body)).status, 200);
   const saved = JSON.parse((await call('/reader/api/session')).text);
   assert.deepEqual(saved.records, body.records);
   // The unchanged localhost workflow still writes to the very same database.
   assert.equal((await call('/reader/api/save', { 'Content-Type': 'application/json',
    Origin: local, 'X-Reader-Token': saved.token }, { records: saved.records, revision: saved.revision })).status, 200);
   await new Promise(r => server.close(r)); server = null;
  }
 } finally { if (server) await new Promise(r => server.close(r)); await rm(root, { recursive: true, force: true }); }
});
