import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer, parseActorRows, validPostUrl} from '../server.mjs';

test('HarvestAPI preserves commenter photos and comments while deduplicating root authors',()=>{
  const person={id:'member-a',name:'Deniz Kaya',linkedinUrl:'https://www.linkedin.com/in/deniz',pictureUrl:'https://media.licdn.com/photo.jpg'};
  const result=parseActorRows([
    {type:'comment',actor:person,commentary:'İlk yorum',replies:[{actor:{id:'reply-author',name:'Yanıt Sahibi'}}]},
    {type:'comment',actor:person,commentary:'Tekrar yorum'},
    {type:'comment',actor:{id:'member-b',name:'Ece',picture:{url:'https://media.licdn.com/ece.jpg'}},commentary:'Merhaba'}
  ]);
  assert.deepEqual(result.participants,[
    {id:'member-a',name:'Deniz Kaya',profileUrl:'https://www.linkedin.com/in/deniz',imageUrl:'https://media.licdn.com/photo.jpg',comment:'İlk yorum'},
    {id:'member-b',name:'Ece',imageUrl:'https://media.licdn.com/ece.jpg',comment:'Merhaba'}
  ]);
  assert.equal(result.duplicates,1);
});

test('HarvestAPI provider uses its own input contract without profile enrichment charges',async()=>{
  let calls=0;
  const server=createServer({databasePath:':memory:',apiToken:'fixture',provider:'harvestapi',actorFetch:async(url,options)=>{
    calls++;
    assert.equal(url,'https://api.apify.com/v2/acts/harvestapi~linkedin-post-comments/run-sync-get-dataset-items');
    assert.deepEqual(JSON.parse(options.body),{posts:['https://www.linkedin.com/posts/example_123'],maxItems:0,profileScraperMode:'short'});
    return new Response(JSON.stringify([{type:'comment',actor:{id:'a',name:'Deniz'},commentary:'Merhaba'}]));
  }});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/comments',{method:'POST',body:JSON.stringify({url:'https://www.linkedin.com/posts/example_123'})});
    assert.equal(response.status,200);
    const result=await response.json();
    assert.equal(result.provider,'harvestapi');
    assert.equal(result.participants[0].comment,'Merhaba');
    assert.equal(calls,1);
  }finally{await new Promise(resolve=>server.close(resolve));}
});

test('Apify input errors preserve the real rejection reason while hiding API tokens',async()=>{
  const server=createServer({databasePath:':memory:',apiToken:'private-fixture-secret',actorFetch:async()=>new Response(JSON.stringify({error:{type:'invalid-input',message:'Input is not valid: Field input.post_urls must contain a valid URL. Token: private-fixture-secret'}}),{status:400})});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/comments',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:'https://www.linkedin.com/posts/example_123'})});
    const body=await response.json();
    assert.equal(response.status,502);
    assert.equal(body.upstreamStatus,400);
    assert.equal(body.providerCode,'invalid-input');
    assert.match(body.error,/input\.post_urls/);
    assert.doesNotMatch(JSON.stringify(body),/private-fixture-secret/);
  }finally{await new Promise(resolve=>server.close(resolve));}
});

test('Preserves the first available comment without increasing entries for repeat commenters',()=>{
  const result=parseActorRows([
    {commenter_id:'a',commenter_name:'Deniz',comment_text:'  İlk yorum\nTeşekkürler!  '},
    {commenter_id:'a',commenter_name:'Deniz',comment_text:'İkinci yorum'},
    {commenter_id:'b',commenter_name:'Ece',comment_text:''},
    {commenter_id:'b',commenter_name:'Ece',comment_text:'Sonradan gelen yorum'}
  ]);
  assert.deepEqual(result.participants,[{id:'a',name:'Deniz',comment:'İlk yorum\nTeşekkürler!'},{id:'b',name:'Ece',comment:'Sonradan gelen yorum'}]);
  assert.equal(result.duplicates,2);
});

test('Keeps LinkedIn profile and photo URLs even when supplied by a later duplicate comment',()=>{
  const result=parseActorRows([
    {commenter_id:'a',commenter_name:'Deniz'},
    {commenter_id:'a',commenter_name:'Deniz',commenter_linkedin_url:'https://www.linkedin.com/in/deniz',commenter_image_url:'https://media.licdn.com/dms/image/photo.jpg'}
  ]);
  assert.deepEqual(result.participants,[{id:'a',name:'Deniz',profileUrl:'https://www.linkedin.com/in/deniz',imageUrl:'https://media.licdn.com/dms/image/photo.jpg'}]);
  assert.equal(result.duplicates,1);
});

test('Drops invalid profile and photo URLs without losing participants',()=>{
  const result=parseActorRows([{commenter_id:'a',commenter_name:'Deniz',commenter_linkedin_url:'javascript:alert(1)',commenter_image_url:'http://evil.test/pixel'}]);
  assert.deepEqual(result.participants,[{id:'a',name:'Deniz'}]);
});

test('Data Slayer root commenters are deduplicated while nested replies stay outside the draw',()=>{
  const result=parseActorRows([
    {comment_id:'1',commenter_id:'a',commenter_name:' Deniz  Kaya ',post_comment_count:5,top_replies:[{commenter_id:'reply',commenter_name:'Reply Author'}]},
    {comment_id:'2',commenter_id:'a',commenter_name:'Deniz Kaya',post_comment_count:5},
    {comment_id:'3',commenter_linkedin_url:'https://www.linkedin.com/in/other',commenter_name:'Deniz Kaya',post_comment_count:5},
    {comment_id:'4',commenter_name:'No identity',post_comment_count:5},
    {comment_id:'5',commenter_id:'nameless',post_comment_count:5}
  ]);
  assert.deepEqual(result,{
    participants:[{id:'a',name:'Deniz Kaya'},{id:'https://www.linkedin.com/in/other',name:'Deniz Kaya',profileUrl:'https://www.linkedin.com/in/other'}],
    received:5,missingNames:2,filtered:0,duplicates:1,possibleLimit:false
  });
});

test('Warns when Data Slayer returns fewer root comments than reported',()=>{
  assert.equal(parseActorRows([{commenter_id:'a',commenter_name:'Deniz',post_comment_count:4}]).possibleLimit,true);
});

test('A complete Data Slayer result above 1000 comments does not trigger the old provider limit',()=>{
  const rows=Array.from({length:1001},(_,i)=>({comment_id:String(i),commenter_id:String(i),commenter_name:'Person',post_comment_count:1001}));
  assert.equal(parseActorRows(rows).possibleLimit,false);
});

test('LinkedIn URL validation disallows injected domains and non-post URLs',()=>{
  assert.equal(validPostUrl('https://www.linkedin.com/posts/latentshift_123'),true);
  assert.equal(validPostUrl('https://www.linkedin.com/feed/update/urn:li:activity:1234/'),true);
  assert.equal(validPostUrl('https://linkedin.com.evil.test/posts/123'),false);
  assert.equal(validPostUrl('file:///etc/passwd'),false);
  assert.equal(validPostUrl('http://www.linkedin.com/posts/x'),false);
});

test('Deduplicates by member id, not by same person display name',()=>{
  const rows=[
    {type:'comment',actor:{id:'person-1',name:'Ayşe Yılmaz'}},
    {type:'comment',actor:{id:'person-1',name:'Ayşe Yılmaz'}},
    {type:'comment',actor:{id:'person-2',name:'Ayşe Yılmaz'}},
    {type:'comment',actor:{id:'person-3',name:'Deniz Kaya'}},
    {type:'comment',actor:{id:'person-4'}},
    {type:'summary',some:'data'}
  ];
  assert.deepEqual(parseActorRows(rows),{
    participants:[{id:'person-1',name:'Ayşe Yılmaz'},{id:'person-2',name:'Ayşe Yılmaz'},{id:'person-3',name:'Deniz Kaya'}],
    received:6,missingNames:1,filtered:1,duplicates:1,possibleLimit:false
  });
});

test('Serves HTML, validates URL, and passes data to Apify without exposing token', async()=>{
  let calls=0;
  const server=createServer({databasePath:':memory:',apiToken:'test-private-token',provider:'data-slayer',actorFetch:async(url,opts)=>{
    calls++;
    assert.equal(url,'https://api.apify.com/v2/acts/data-slayer~linkedin-post-comments/run-sync-get-dataset-items');
    assert.equal(opts.headers.Authorization,'Bearer test-private-token');
    assert.deepEqual(JSON.parse(opts.body),{post_urls:['https://www.linkedin.com/posts/x_123'],max_comments_per_post:0});
    return new Response(JSON.stringify([{commenter_id:'abc',commenter_name:'Örnek Kişi',post_comment_count:1}]),{status:200});
  }});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  try {
    const page=await fetch(base+'/');
    assert.equal(page.status,200);
    const html=await page.text();
    assert.match(html,/Yorumları getir/);
    assert.doesNotMatch(html,/test-private-token/);
    const bad=await fetch(base+'/api/comments',{method:'POST',body:JSON.stringify({url:'https://evil.com/'})});
    assert.equal(bad.status,400);
    const res=await fetch(base+'/api/comments',{method:'POST',body:JSON.stringify({url:'https://www.linkedin.com/posts/x_123'})});
    assert.equal(res.status,200);
    assert.deepEqual((await res.json()).participants,[{id:'abc',name:'Örnek Kişi'}]);
    assert.equal(calls,1);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
