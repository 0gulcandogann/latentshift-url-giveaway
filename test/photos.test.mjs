import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,unlink,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createServer} from '../server.mjs';

async function start(options){
  const server=createServer({databasePath:':memory:',...options});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {get:url=>fetch('http://127.0.0.1:'+server.address().port+'/api/photo?url='+encodeURIComponent(url)),close:()=>new Promise(resolve=>server.close(resolve))};
}

test('Profile photos persist across restarts and concurrent requests download once',async()=>{
  const folder=await mkdtemp(path.join(tmpdir(),'latentshift-photo-'));
  const databasePath=path.join(folder,'photos.sqlite');
  let calls=0;
  const photoUrl='https://media.licdn.com/photo.jpg';
  let app=await start({databasePath,photoFetch:async(url,options)=>{
    calls++;assert.equal(url,photoUrl);assert.equal(options.redirect,'error');
    await new Promise(resolve=>setTimeout(resolve,10));
    return new Response('image-bytes',{headers:{'Content-Type':'image/jpeg'}});
  }});
  try{
    const replies=await Promise.all([app.get(photoUrl),app.get(photoUrl)]);
    assert.ok(replies.every(reply=>reply.status===200));
    assert.equal(await replies[0].text(),'image-bytes');assert.equal(calls,1);
    await app.close();
    app=await start({databasePath,photoFetch:async()=>{throw new Error('Must use local photo');}});
    const cached=await app.get(photoUrl);
    assert.equal(cached.status,200);assert.equal(await cached.text(),'image-bytes');
    assert.match(cached.headers.get('content-type'),/image\/jpeg/);
    assert.equal(calls,1);
  }finally{await app.close();await unlink(databasePath).catch(()=>{});await rmdir(folder).catch(()=>{});}
});

test('Photo downloads reject non-LinkedIn hosts and do not cache invalid content or transient errors',async()=>{
  let calls=0;
  const app=await start({photoFetch:async()=>{
    calls++;
    return calls===1?new Response('try later',{status:429}):calls===2?new Response('<html>blocked</html>',{headers:{'Content-Type':'text/html'}}):new Response('photo',{headers:{'Content-Type':'image/png'}});
  }});
  try{
    assert.equal((await app.get('https://evil.test/photo.jpg')).status,400);assert.equal(calls,0);
    const url='https://media.licdn.com/retry.png';
    assert.equal((await app.get(url)).status,429);
    assert.equal((await app.get(url)).status,502);
    assert.equal((await app.get(url)).status,200);
    assert.equal((await app.get(url)).status,200);assert.equal(calls,3);
  }finally{await app.close();}
});
