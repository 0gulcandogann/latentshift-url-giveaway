import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
function element(tag){
  return {tag,children:[],style:{setProperty(){}},attrs:{},listeners:{},
    append(...items){this.children.push(...items);},
    setAttribute(key,value){this.attrs[key]=value;},
    addEventListener(event,callback){this.listeners[event]=callback;},
    remove(){this.removed=true;}};
}
const context=vm.createContext({URL,setTimeout,clearTimeout,document:{getElementById:()=>element('div'),createElement:element,createElementNS:(_,tag)=>element(tag)}});
vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1].replace('    setup();','    globalThis.ui={cleanNames,makeCard,makeProfileLink,makePortrait:typeof makePortrait==="function"?makePortrait:undefined,preloadPortraits:typeof preloadPortraits==="function"?preloadPortraits:undefined,prepareDraw:typeof prepareDraw==="function"?prepareDraw:undefined,shuffledPeople:typeof shuffledPeople==="function"?shuffledPeople:undefined,getState:()=>({participants,sourceType})};'),context);

test('Every entrant can win through exactly one selection index regardless of repeated comments',()=>{
  const people=[{id:'a',name:'Same name'},{id:'a',name:'Same name'},{id:'b',name:'Same name'},{id:'c',name:'Other'}];
  const winners=[];
  for(let index=0;index<3;index++){
    let first=true;
    context.window={crypto:{getRandomValues(array){array[0]=first?index:0;first=false;return array;}}};
    const draw=context.ui.prepareDraw(people);
    winners.push(draw.winner.id);
    assert.equal(draw.items.length,3);
    assert.equal(new Set(draw.items.map(person=>person.id)).size,3);
    assert.equal(draw.items[draw.index].id,draw.winner.id);
  }
  assert.deepEqual(winners,['a','b','c']);
});

test('Reel sequences contain no repeated identities for small and large pools',()=>{
  context.window={crypto:{getRandomValues(array){array[0]=0;return array;}}};
  for(const count of [1,2,5,19,79,1000]){
    const people=Array.from({length:count},(_,i)=>({id:String(i),name:'Person '+i}));
    const draw=context.ui.prepareDraw(people);
    assert.equal(new Set(draw.items.map(person=>person.id)).size,draw.items.length);
    assert.equal(draw.items.filter(person=>person.id===draw.winner.id).length,1);
    assert.ok(draw.index<draw.items.length);
    const idle=context.ui.shuffledPeople(people).slice(0,19);
    assert.equal(new Set(idle.map(person=>person.id)).size,idle.length);
  }
  assert.equal(context.ui.prepareDraw([]),null);
});

test('Live startup has no demo entrants',()=>{
  assert.equal(context.ui.getState().participants.length,0);
  assert.equal(context.ui.getState().sourceType,'linkedin');
});

test('Comment text survives participant cleanup',()=>{
  const result=context.ui.cleanNames([{id:'a',name:'Deniz',comment:'Merhaba\nDünya!'}]);
  assert.equal(result[0].comment,'Merhaba\nDünya!');
});

test('Preloading deduplicates photos and completes after success and failure',async()=>{
  let created=0,active=0,maximum=0;
  context.Image=class {
    constructor(){created++;}
    set src(value){
      if(!value)return;
      active++;maximum=Math.max(maximum,active);
      setTimeout(()=>{active--;value.includes('missing')?this.onerror():this.onload();},1);
    }
    async decode(){}
  };
  const people=[{imageUrl:'https://media.licdn.com/a.jpg'},{imageUrl:'https://media.licdn.com/a.jpg'},{imageUrl:'https://media.licdn.com/missing.jpg'},...Array.from({length:10},(_,i)=>({imageUrl:'https://media.licdn.com/extra-'+i+'.jpg'}))];
  const progress=[];
  const result=await context.ui.preloadPortraits(people,(state)=>progress.push({...state}));
  assert.equal(created,13);
  assert.equal(result.total,12);
  assert.equal(result.loaded,11);
  assert.equal(result.failed,1);
  assert.equal(progress.at(-1).completed,12);
  assert.ok(maximum<=6);
});

test('A photo that never loads times out and still completes preparation',async()=>{
  context.Image=class {set src(value){}};
  context.setTimeout=(callback)=>setTimeout(callback,1);
  try{
    const result=await context.ui.preloadPortraits([{imageUrl:'https://media.licdn.com/stalled.jpg'}]);
    assert.equal(result.completed,1);
    assert.equal(result.failed,1);
    assert.equal(result.loaded,0);
  }finally{context.setTimeout=setTimeout;}
});

test('Preparing a list with no photos completes immediately',async()=>{
  const result=await context.ui.preloadPortraits([{name:'Deniz'}]);
  assert.equal(result.total,0);
  assert.equal(result.completed,0);
});

test('Photo preparation does not discard queued people after 45 seconds',async()=>{
  let ticks=0;
  context.Date=class extends Date {static now(){ticks+=50000;return ticks;}};
  context.Image=class {set src(value){if(value)setTimeout(()=>this.onload(),1);}async decode(){}};
  try{
    const result=await context.ui.preloadPortraits(Array.from({length:20},(_,i)=>({imageUrl:'https://media.licdn.com/slow-'+i+'.jpg'})));
    assert.equal(result.loaded,20);assert.equal(result.failed,0);
  }finally{delete context.Date;}
});

test('Retrying photos keeps decoded successes and downloads only failed photos again',async()=>{
  const calls={};let recover=false;
  context.setTimeout=(callback,delay)=>setTimeout(callback,delay>1000?100:1);
  context.Image=class {
    set src(value){if(value){calls[value]=(calls[value]||0)+1;setTimeout(()=>value.includes('retry-me')&&!recover?this.onerror():this.onload(),1);}}
    async decode(){}
  };
  try{
    const people=[{imageUrl:'https://media.licdn.com/keep-me.jpg'},{imageUrl:'https://media.licdn.com/retry-me.jpg'}];
    assert.equal((await context.ui.preloadPortraits(people)).failed,1);
    recover=true;
    const recovered=await context.ui.preloadPortraits(people);
    assert.equal(recovered.loaded,2);assert.equal(recovered.failed,0);
    assert.equal(calls['/api/photo?url=https%3A%2F%2Fmedia.licdn.com%2Fkeep-me.jpg'],1);
    assert.equal(calls['/api/photo?url=https%3A%2F%2Fmedia.licdn.com%2Fretry-me.jpg'],3);
  }finally{context.setTimeout=setTimeout;}
});

test('Participant cleanup preserves validated profile and image fields',()=>{
  const result=context.ui.cleanNames([{id:'a',name:'Deniz',profileUrl:'https://www.linkedin.com/in/deniz',imageUrl:'https://media.licdn.com/photo.jpg'}]);
  assert.equal(result[0].profileUrl,'https://www.linkedin.com/in/deniz');
  assert.equal(result[0].imageUrl,'https://media.licdn.com/photo.jpg');
});

test('Reel card uses a photo and keeps a fallback when loading fails',()=>{
  const card=context.ui.makeCard({id:'a',name:'Deniz',imageUrl:'https://media.licdn.com/photo.jpg'},0);
  const portrait=card.children[1];
  const photo=portrait.children.find(child=>child.tag==='img');
  assert.ok(photo);
  assert.equal(photo.src,'/api/photo?url=https%3A%2F%2Fmedia.licdn.com%2Fphoto.jpg');
  assert.equal(photo.referrerPolicy,'no-referrer');
  photo.listeners.error();
  assert.equal(photo.removed,true);
  assert.ok(portrait.children.some(child=>child.tag==='svg'));
});

test('Missing and untrusted photo URLs use only the geometric fallback',()=>{
  for(const imageUrl of [undefined,'javascript:alert(1)','https://evil.test/photo.jpg']){
    const portrait=context.ui.makePortrait({name:'Deniz',imageUrl},0);
    assert.equal(portrait.children.some(child=>child.tag==='img'),false);
    assert.equal(portrait.children[0].tag,'svg');
  }
});

test('Profile links open LinkedIn safely and absent or invalid URLs stay plain text',()=>{
  const link=context.ui.makeProfileLink({name:'Deniz',profileUrl:'https://www.linkedin.com/in/deniz'},'Deniz');
  assert.equal(link.tag,'a');
  assert.equal(link.href,'https://www.linkedin.com/in/deniz');
  assert.equal(link.rel,'noopener noreferrer');
  assert.equal(link.target,'_blank');
  for(const profileUrl of [undefined,'javascript:alert(1)','https://linkedin.com.evil.test/in/deniz']){
    assert.equal(context.ui.makeProfileLink({name:'Deniz',profileUrl},'Deniz').tag,'span');
  }
});
