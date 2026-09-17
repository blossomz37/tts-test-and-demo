// Optional loopback static server. No packages; byte ranges support audio seeking.
import http from 'node:http';
import { stat, realpath } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, sep, extname } from 'node:path';
const root = await realpath(fileURLToPath(new URL('.',import.meta.url)));
const index=process.argv.indexOf('--port');
const port=index<0?0:Number(process.argv[index+1]);
if(!Number.isInteger(port)||port<0||port>65535)throw Error('Use --port 0 or a port number from 1 to 65535.');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.md':'text/plain; charset=utf-8','.txt':'text/plain; charset=utf-8','.woff2':'font/woff2','.svg':'image/svg+xml','.mp3':'audio/mpeg','.wav':'audio/wav'};
const server=http.createServer(async(req,res)=>{
 try {
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{Allow:'GET, HEAD'});res.end();return;}
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  const candidate=resolve(root,'.'+pathname+(pathname.endsWith('/')?'index.html':''));
  if(!candidate.startsWith(root+sep))throw Error('Outside release');
  const file=await realpath(candidate);
  if(!file.startsWith(root+sep))throw Error('Outside release');
  const info=await stat(file);if(!info.isFile())throw Error('Not a file');
  let start=0,end=info.size-1,status=200;
  const headers={'Content-Type':types[extname(file)]||'application/octet-stream','Accept-Ranges':'bytes','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'};
  if(req.headers.range){
   const match=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
   if(!match||(!match[1]&&!match[2])){res.writeHead(416,{'Content-Range':`bytes */${info.size}`});res.end();return;}
   if(!match[1])start=Math.max(0,info.size-Number(match[2]));
   else {start=Number(match[1]);if(match[2])end=Math.min(end,Number(match[2]));}
   if(start>end||start>=info.size){res.writeHead(416,{'Content-Range':`bytes */${info.size}`});res.end();return;}
   status=206;headers['Content-Range']=`bytes ${start}-${end}/${info.size}`;
  }
  headers['Content-Length']=Math.max(0,end-start+1);res.writeHead(status,headers);
  if(req.method==='HEAD'||!info.size){res.end();return;}
  const stream=createReadStream(file,{start,end});stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res);
 }catch{if(!res.headersSent)res.writeHead(404);res.end('Not found');}
});
server.on('error',e=>{console.error(e.code==='EADDRINUSE'?'Port is in use. Choose --port 0 or another assigned port.':e.message);process.exitCode=1;});
server.listen(port,'127.0.0.1',()=>console.log(`Voice study: http://127.0.0.1:${server.address().port}/`));
