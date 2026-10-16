import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,unlink,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createServer} from '../server.mjs';

async function start(options={}){
  const server=createServer({databasePath:':memory:',apiToken:'fixture',...options});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  return {server,close:()=>new Promise(resolve=>server.close(resolve)),request:async(route,method='GET',body)=>{
    const response=await fetch(base+route,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
    return {status:response.status,data:await response.json()};
  }};
}
const post='https://www.linkedin.com/feed/update/urn:li:activity:123456789';
const row={commenter_id:'a',commenter_name:'Deniz',comment_text:'Merhaba!',commenter_linkedin_url:'https://www.linkedin.com/in/deniz',commenter_image_url:'https://media.licdn.com/photo.jpg',post_comment_count:1};
const snapshot={participants:[{id:'a',name:'Deniz',comment:'Merhaba!',profileUrl:row.commenter_linkedin_url,imageUrl:row.commenter_image_url}],history:[{id:'a',name:'Deniz',time:'2026-10-16T10:00:00.000Z'}],sourceType:'apify',postUrl:post,postKey:post,excludePrevious:true,showComments:false,savedAt:123};

test('Resetting the active session keeps cached comments available without another actor call',async()=>{
  let calls=0;
  const app=await start({actorFetch:async()=>{calls++;return new Response(JSON.stringify([row]));}});
  try{
    await app.request('/api/comments','POST',{url:post});
    await app.request('/api/session','PUT',snapshot);
    const empty={participants:[],history:[],sourceType:'linkedin',postUrl:'',postKey:'',excludePrevious:true,showComments:false,savedAt:124};
    assert.equal((await app.request('/api/session','PUT',empty)).status,200);
    assert.deepEqual((await app.request('/api/session')).data.state,empty);
    const cached=await app.request('/api/comments','POST',{url:post});
    assert.equal(cached.data.cached,true);assert.equal(cached.data.participants.length,1);assert.equal(calls,1);
  }finally{await app.close();}
});

test('Session and comment cache survive a server restart without another paid call',async()=>{
  const folder=await mkdtemp(path.join(tmpdir(),'latentshift-db-'));
  const databasePath=path.join(folder,'giveaway.sqlite');
  let calls=0;
  let app=await start({databasePath,actorFetch:async()=>{calls++;return new Response(JSON.stringify([row]));}});
  try{
    assert.equal((await app.request('/api/session')).data.state,null);
    assert.equal((await app.request('/api/comments','POST',{url:post})).status,200);
    assert.equal((await app.request('/api/session','PUT',snapshot)).status,200);
    await app.close();
    app=await start({databasePath,apiToken:'',actorFetch:async()=>{throw new Error('Must not call Apify');}});
    const restored=await app.request('/api/session');
    assert.deepEqual(restored.data.state,snapshot);
    const cached=await app.request('/api/comments','POST',{url:post+'/?utm_source=test#tracking'});
    assert.equal(cached.status,200);
    assert.equal(cached.data.cached,true);
    assert.equal(cached.data.participants[0].comment,'Merhaba!');
    assert.equal(calls,1);
  }finally{await app.close();await unlink(databasePath).catch(()=>{});await rmdir(folder).catch(()=>{});}
});

test('Only an explicit refresh calls Apify again and concurrent cache misses share one call',async()=>{
  let calls=0;
  const app=await start({actorFetch:async()=>{calls++;await new Promise(resolve=>setTimeout(resolve,30));return new Response(JSON.stringify([row]));}});
  try{
    const results=await Promise.all([app.request('/api/comments','POST',{url:post}),app.request('/api/comments','POST',{url:post})]);
    assert.ok(results.every(result=>result.status===200));
    assert.equal(calls,1);
    assert.equal((await app.request('/api/comments','POST',{url:post})).data.cached,true);
    assert.equal(calls,1);
    const refreshed=await app.request('/api/comments','POST',{url:post,refresh:true});
    assert.equal(refreshed.status,200);
    assert.equal(refreshed.data.cached,false);
    assert.equal(calls,2);
  }finally{await app.close();}
});

test('A failed refresh and invalid session update preserve previously stored data',async()=>{
  let calls=0;
  const app=await start({actorFetch:async()=>++calls===1?new Response(JSON.stringify([row])):new Response('failure',{status:503})});
  try{
    await app.request('/api/comments','POST',{url:post});
    await app.request('/api/session','PUT',snapshot);
    assert.equal((await app.request('/api/comments','POST',{url:post,refresh:true})).status,502);
    assert.equal((await app.request('/api/comments','POST',{url:post})).data.participants[0].name,'Deniz');
    assert.equal((await app.request('/api/session','PUT',{participants:'invalid'})).status,400);
    assert.deepEqual((await app.request('/api/session')).data.state,snapshot);
  }finally{await app.close();}
});
