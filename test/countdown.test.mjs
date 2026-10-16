import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
function clockState(now){
  const source=html.match(/<script id="drawClockScript">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(source,'Draw clock script exists');
  const context=vm.createContext({Date});
  vm.runInContext(source.replace('    startDrawClock();','    globalThis.clockState=getDrawClockState;'),context);
  return context.clockState(Date.parse(now));
}
test('Countdown targets 17 October 16:40 in Istanbul and retains hours above 24',()=>{
  const state=clockState('2026-10-16T10:00:00Z');
  assert.equal(state.phase,'countdown');
  assert.equal(state.digits,'274000');
  assert.equal(clockState('2026-10-17T13:39:59Z').digits,'000001');
});
test('Clock enters number animation exactly at the deadline without negative numbers',()=>{
  assert.equal(clockState('2026-10-17T13:40:00Z').phase,'draw');
  assert.equal(clockState('2026-10-17T13:40:00Z').digits,'000000');
  assert.equal(clockState('2026-10-17T13:40:01Z').digits,'111111');
});
