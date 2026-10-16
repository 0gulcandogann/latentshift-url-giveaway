import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {openStorage} from './storage.mjs';

const dir = path.dirname(fileURLToPath(import.meta.url));

export async function loadLocalEnv() {
  try {
    const contents = await readFile(path.join(dir, '.env'), 'utf8');
    for (const line of contents.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (match && !process.env[match[1]]) {
        process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
      }
    }
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
}

export function validPostUrl(raw) {
  try {
    const url = new URL(String(raw ?? '').trim());
    if (url.protocol !== 'https:') return false;
    if (!['linkedin.com', 'www.linkedin.com', 'tr.linkedin.com'].includes(url.hostname.toLowerCase())) return false;
    return /^\/(posts\/|feed\/update\/|pulse\/)/.test(url.pathname);
  } catch { return false; }
}

const normalName = s => String(s ?? '').trim().replace(/\s+/g,' ');
function linkedInAsset(raw, image=false) {
  try {
    const url=new URL(raw);
    const domain=image?'licdn.com':'linkedin.com';
    if(url.protocol==='https:' && !url.username && !url.password && (url.hostname===domain || url.hostname.endsWith('.'+domain))) return url.href;
  } catch {}
  return '';
}
export function parseActorRows(rows) {
  if (!Array.isArray(rows)) throw new Error('Servis liste döndürmedi.');
  const unique = new Map();
  const posts = new Map();
  let dataSlayer = false;
  let missingNames = 0, filtered = 0;
  for (const row of rows) {
    if (!row || typeof row !== 'object') { filtered++; continue; }
    if (row.type && row.type !== 'comment' && row.type !== 'reply') { filtered++; continue; }
    if ('commenter_name' in row || 'post_comment_count' in row) {
      dataSlayer = true;
      const postKey = row.post_id ?? row.post_url ?? 'post';
      const post = posts.get(postKey) ?? {received:0, reported:0};
      post.received++;
      if (Number.isFinite(row.post_comment_count)) post.reported = Math.max(post.reported, row.post_comment_count);
      posts.set(postKey, post);
    }
    const actor = row.actor ?? row.author ?? row.user ?? {};
    const name = normalName(row.commenter_name ?? actor.name ?? actor.fullName ?? row.authorName ?? row.name);
    const actorId = normalName(row.commenter_id) || normalName(row.commenter_linkedin_url) || normalName(actor.id ?? actor.linkedinUrl ?? actor.profileUrl ?? row.authorUrl);
    if (!name) { missingNames++; continue; }
    if (!actorId) { missingNames++; continue; } // stable identity required for a fair dedupe
    const key = actorId.toLocaleLowerCase('en-US');
    const person=unique.get(key) ?? {id: actorId, name};
    const profileUrl=linkedInAsset(row.commenter_linkedin_url ?? actor.linkedinUrl ?? actor.profileUrl ?? row.authorUrl);
    const imageUrl=linkedInAsset(row.commenter_image_url ?? actor.pictureUrl ?? actor.picture?.url,true);
    if(profileUrl && !person.profileUrl) person.profileUrl=profileUrl;
    if(imageUrl && !person.imageUrl) person.imageUrl=imageUrl;
    const comment=row.comment_text ?? row.commentary;
    if(typeof comment==='string' && !person.comment && comment.trim()) person.comment=comment.trim();
    unique.set(key,person);
  }
  return { participants: [...unique.values()], received: rows.length, missingNames, filtered,
    duplicates: rows.length - missingNames - filtered - unique.size,
    possibleLimit: dataSlayer ? [...posts.values()].some(post => post.received < post.reported) : rows.length >= 1000 };
}

export function canonicalPostUrl(raw){
  const url=new URL(raw);
  const activity=url.pathname.match(/(activity|ugcPost)[-:](\d+)/);
  return activity?'https://www.linkedin.com/feed/update/urn:li:'+activity[1]+':'+activity[2]:'https://www.linkedin.com'+url.pathname.replace(/\/+$/,'');
}

function validateSession(state){
  const invalid=()=>{throw Object.assign(new Error('Çekiliş kaydı geçersiz.'),{status:400});};
  if(!state || !Array.isArray(state.participants) || !Array.isArray(state.history) || state.participants.length>10000 || state.history.length>10000 || !['apify','manual','linkedin'].includes(state.sourceType))invalid();
  const seen=new Set();
  const participants=state.participants.map(person=>{
    if(!person || typeof person.id!=='string' || !person.id.trim() || person.id.length>512 || typeof person.name!=='string' || !person.name.trim() || person.name.length>160 || seen.has(person.id.toLowerCase()))invalid();
    seen.add(person.id.toLowerCase());
    const result={id:person.id,name:person.name};
    for(const [field,image] of [['profileUrl',false],['imageUrl',true]]){const url=linkedInAsset(person[field],image);if(url)result[field]=url;}
    if(typeof person.comment==='string' && person.comment)result.comment=person.comment;
    return result;
  });
  const members=new Map(participants.map(person=>[person.id,person]));
  const history=state.history.map(winner=>{
    if(!winner || !members.has(winner.id) || typeof winner.time!=='string' || !Number.isFinite(Date.parse(winner.time)))invalid();
    // Preserve the fields actually included in each saved winner record.
    const result={id:winner.id,name:members.get(winner.id).name,time:winner.time};
    for(const field of ['profileUrl','imageUrl','comment'])if(members.get(winner.id)[field] && winner[field])result[field]=members.get(winner.id)[field];
    return result;
  });
  const postUrl=typeof state.postUrl==='string'?state.postUrl:'';
  if(postUrl && !validPostUrl(postUrl))invalid();
  if(state.sourceType==='apify' && !postUrl)invalid();
  return {participants,history,sourceType:state.sourceType,postUrl,postKey:postUrl?canonicalPostUrl(postUrl):'',excludePrevious:state.excludePrevious!==false,showComments:state.showComments!==false,savedAt:Number.isFinite(state.savedAt)&&state.savedAt>0?state.savedAt:Date.now()};
}

async function readJson(req,limit){
  const chunks=[];let size=0;
  for await(const chunk of req){size+=chunk.length;if(size>limit)throw Object.assign(new Error('İstek çok büyük.'),{status:413});chunks.push(chunk);}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Object.assign(new Error('Geçerli JSON verisi gönderin.'),{status:400});}
}

export function createServer({apiToken=process.env.APIFY_TOKEN, actorFetch=globalThis.fetch, photoFetch=globalThis.fetch, databasePath=path.join(dir,'data','giveaway.sqlite'),provider=process.env.APIFY_PROVIDER||'harvestapi'}={}) {
  const providers={
    harvestapi:{actor:'harvestapi~linkedin-post-comments',input:url=>({posts:[url],maxItems:0,profileScraperMode:'short'})},
    'data-slayer':{actor:'data-slayer~linkedin-post-comments',input:url=>({post_urls:[url],max_comments_per_post:0})}
  };
  const selected=providers[provider];
  if(!selected)throw new Error('APIFY_PROVIDER harvestapi veya data-slayer olmalıdır.');
  const storage=openStorage(databasePath);
  const inFlight=new Map();
  const photoRequests=new Map();
  async function downloadPhoto(url){
    const response=await photoFetch(url,{redirect:'error',headers:{Accept:'image/*'},signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw Object.assign(new Error('Fotoğraf yüklenemedi.'),{status:response.status});
    const mime=(response.headers.get('Content-Type')||'').split(';')[0].trim().toLowerCase();
    if(!/^image\/[a-z0-9.+-]+$/.test(mime))throw new Error('Geçersiz fotoğraf yanıtı.');
    const chunks=[];let size=0;
    for await(const chunk of response.body){size+=chunk.length;if(size>5*1024*1024)throw Object.assign(new Error('Fotoğraf çok büyük.'),{status:413});chunks.push(chunk);}
    const bytes=Buffer.concat(chunks);
    if(!bytes.length)throw new Error('Fotoğraf boş.');
    storage.putPhoto(url,mime,bytes);return {mime,bytes};
  }
  async function importComments(url,postKey){
    if(!apiToken)throw Object.assign(new Error('Apify erişim anahtarı yok. .env dosyasında APIFY_TOKEN ayarlayın.'),{status:503});
    const upstream=await actorFetch(`https://api.apify.com/v2/acts/${selected.actor}/run-sync-get-dataset-items`, {
      method:'POST',headers:{'Authorization':`Bearer ${apiToken}`,'Content-Type':'application/json','Accept':'application/json'},
      body:JSON.stringify(selected.input(url)),signal:AbortSignal.timeout(245000)
    });
    if(!upstream.ok){
      const prefix=upstream.status===401?'Apify API anahtarı geçersiz.':upstream.status===402?'Apify hesabında yeterli bakiye yok.':upstream.status===408?'Yorum çekme zaman aşımına uğradı.':`Yorum servisi ${upstream.status} hatası döndürdü.`;
      let providerCode='',detail='';
      try{
        const payload=await upstream.json();
        if(typeof payload.error?.type==='string')providerCode=payload.error.type;
        if(typeof payload.error?.message==='string')detail=payload.error.message;
      }catch{}
      const redact=value=>String(value).split(apiToken).join('[gizlendi]').replace(/apify_api_[A-Za-z0-9_-]+/g,'[gizlendi]').slice(0,1500);
      throw Object.assign(new Error(prefix+(detail?' '+redact(detail):'')),{upstreamStatus:upstream.status,providerCode:redact(providerCode)});
    }
    const rows=await upstream.json();
    const parsed=parseActorRows(rows);
    if(!parsed.participants.length)throw new Error('Katılımcı bulunamadı. Önceki kayıtlar korundu.');
    const result={...parsed,postKey,provider,fetchedAt:new Date().toISOString()};
    storage.putImport(postKey,result,rows);
    return {...result,cached:false};
  }
  const server=http.createServer(async (req,res) => {
    const reply=(status, data) => {res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
    try {
    if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
      const html=await readFile(path.join(dir,'public/index.html'));
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"frame-ancestors 'none'"});
      res.end(html); return;
    }
    if (req.method === 'GET' && req.url === '/health') {reply(200,{ok:true,configured:!!apiToken,provider});return;}
    if(req.method==='GET' && req.url.startsWith('/api/photo?')){
      const url=new URL(req.url,'http://localhost').searchParams.get('url');
      if(!linkedInAsset(url,true)){reply(400,{error:'Geçersiz fotoğraf adresi.'});return;}
      let photo=storage.getPhoto(url);
      if(!photo){
        if(!photoRequests.has(url))photoRequests.set(url,downloadPhoto(url).finally(()=>photoRequests.delete(url)));
        photo=await photoRequests.get(url);
      }
      res.writeHead(200,{'Content-Type':photo.mime,'Cache-Control':'private, max-age=31536000, immutable','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"});
      res.end(photo.bytes);return;
    }
    if(req.url==='/api/session' && req.method==='GET'){reply(200,{state:storage.getSession()});return;}
    if(req.url==='/api/session' && req.method==='PUT'){
      const state=validateSession(await readJson(req,16*1024*1024));
      storage.putSession(state);reply(200,{ok:true,savedAt:state.savedAt});return;
    }
    if (req.method !== 'POST' || req.url !== '/api/comments') {reply(404,{error:'Sayfa bulunamadı.'});return;}
      const {url,refresh}=await readJson(req,8192);
      if (!validPostUrl(url)) {reply(400,{error:'Geçerli bir HTTPS LinkedIn gönderi bağlantısı girin.'});return;}
      const postKey=canonicalPostUrl(url);
      const cached=refresh===true?null:storage.getImport(postKey);
      if(cached){reply(200,{...cached,cached:true});return;}
      if(!inFlight.has(postKey)){
        const task=importComments(url,postKey).finally(()=>inFlight.delete(postKey));
        inFlight.set(postKey,task);
      }
      reply(200,await inFlight.get(postKey));
    } catch (err) {
      reply(err.status||502,{error:err?.name==='TimeoutError'?'Yorum servisi zaman aşımına uğradı.':err.message,...(err.upstreamStatus?{upstreamStatus:err.upstreamStatus,providerCode:err.providerCode}:{})});
    }
  });
  server.once('close',()=>storage.close());
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await loadLocalEnv();
  const server=createServer();
  const port=Number(process.env.PORT||3000);
  server.listen(port,'127.0.0.1',()=>console.log(`LatentShift URL Giveaway: http://127.0.0.1:${port}`));
}
