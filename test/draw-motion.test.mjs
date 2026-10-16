import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
const context=vm.createContext({document:{getElementById:()=>({})}});
vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1].replace('    setup();','    globalThis.motion=typeof drawMotion==="function"?drawMotion:undefined;'),context);

test('Draw keeps two seconds of fast spin before counting every number from ten to one',()=>{
  assert.equal(typeof context.motion,'function');
  assert.equal(context.motion(1999,16,12,3).phase,'fast');
  for(let i=0;i<10;i++){
    const state=context.motion(2000+i*1000,16,12,3);
    assert.equal(state.phase,'countdown');
    assert.equal(state.countdown,10-i);
  }
  assert.equal(context.motion(11999,16,12,3).countdown,1);
  assert.equal(context.motion(12000,16,12,3).phase,'reveal');
});

test('Reveal slows continuously and stops on the selected entrant for small and large pools',()=>{
  assert.equal(typeof context.motion,'function');
  for(const count of [1,2,5,16,82]){
    const index=count-1,center=Math.min(3,Math.floor((count-1)/2));
    const start=context.motion(12000,count,index,center);
    const end=context.motion(100000,count,index,center);
    assert.equal(end.phase,'done');
    assert.ok(end.duration>12000);
    assert.equal((Math.round(end.travel)+center)%count,index);
    assert.ok(start.travel<=end.travel);
    if(count===1)continue;
    const early=context.motion(12100,count,index,center).travel-start.travel;
    const late=end.travel-context.motion(end.duration-100,count,index,center).travel;
    assert.ok(early>late*10,'The reel must decelerate before the winner');
    assert.ok(Math.abs(start.travel-context.motion(11999,count,index,center).travel)<.02);
  }
});
