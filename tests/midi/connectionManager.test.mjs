import test from 'node:test'
import assert from 'node:assert/strict'
import { MidiConnectionManager } from '../../src/midi/connectionManager.ts'
import { MidiStreamParser } from '../../src/midi/streamParser.ts'
import { WebMidiAdapter } from '../../src/midi/webMidiAdapter.ts'
import { NativeMidiAdapter } from '../../src/midi/nativeMidiAdapter.ts'

const input = (id = 'lumi-in', name = 'ROLI LUMI Keys') => ({id,name,state:'connected'})
const output = (id = 'lumi-out', name = 'ROLI LUMI Keys') => ({id,name,state:'connected'})
class FakeAdapter {
  kind = 'web'; supported = true; listeners = new Set(); calls = []; disconnects = 0
  result = {granted:true,sysexEnabled:false,inputs:[input()],outputs:[output()]}
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  async connect(options) { this.calls.push(options); return this.result }
  emit(event) { this.listeners.forEach(listener=>listener(event)) }
  disconnect() { this.disconnects++ }
  send() {}
}
const deferred = () => { let resolve; const promise = new Promise(r => resolve=r); return {promise,resolve} }
test('init and concurrent connect are idempotent; cached snapshots do not change on reads', async () => {
  const adapter=new FakeAdapter(); const pending=deferred()
  adapter.connect=async options=>{adapter.calls.push(options);return pending.promise}
  const manager=new MidiConnectionManager({adapter,onMessage(){}})
  const initial=manager.getStatus(); assert.equal(manager.getStatus(),initial)
  const first=manager.init(), second=manager.init(); assert.equal(first,second)
  pending.resolve(adapter.result); await first
  const [a,b]=await Promise.all([manager.connect(),manager.connect()]); assert.equal(a,true);assert.equal(b,true)
  assert.equal(adapter.calls.length,1);assert.equal(adapter.listeners.size,1)
  manager.dispose();assert.equal(adapter.listeners.size,0)
})
test('denied optional SysEx preserves working notes and their selected port', async () => {
  const adapter=new FakeAdapter(), messages=[]
  adapter.connect=async options=>{adapter.calls.push(options);if(options.sysex)throw new DOMException('Lights permission denied','NotAllowedError');return adapter.result}
  const manager=new MidiConnectionManager({adapter,onMessage:data=>messages.push(data)})
  await manager.connect();assert.equal(await manager.enableLights(),false)
  adapter.emit({type:'message',inputId:'lumi-in',data:[0x90,60,100]})
  assert.equal(manager.getStatus().phase,'connected');assert.equal(manager.getStatus().sysexEnabled,false)
  assert.match(manager.getStatus().lightsError,/denied/);assert.deepEqual(messages,[[0x90,60,100]])
})
test('first auto-choice persists across restart without freezing auto-paired output',async()=>{
 let saved;const adapter=new FakeAdapter()
 const first=new MidiConnectionManager({adapter,onMessage(){},savePreferences:p=>saved=p})
 await first.connect();assert.equal(saved.input.id,'lumi-in');assert.equal(saved.output,undefined)
 adapter.emit({type:'message',inputId:'lumi-in',data:[0x90,60,100]});assert.ok(first.getStatus().lastNote)
 adapter.emit({type:'ports',inputs:[input('fallback','Other keyboard')],outputs:[output('fallback-out','Other keyboard')]})
 assert.equal(saved.input.id,'lumi-in');assert.equal(first.getStatus().lastNote,null)
 first.disconnect();assert.equal(first.getStatus().messageCount,0)
 const secondAdapter=new FakeAdapter();secondAdapter.result.inputs=[input('first','Other keyboard'),input('new-lumi-id')]
 const second=new MidiConnectionManager({adapter:secondAdapter,onMessage(){},loadPreferences:()=>saved})
 await second.connect();assert.equal(second.getStatus().selectedInputId,'new-lumi-id');assert.equal(second.getStatus().selectedOutputId,'lumi-out')
})
test('manual selections survive hotplug, restore by changed ID/name and avoid GS output', async () => {
  const adapter=new FakeAdapter(), releases=[],messages=[];let saved
  adapter.result={...adapter.result,inputs:[input(),input('other','Other Keys')],outputs:[output('synth','Microsoft GS Wavetable Synth'),output(),output('other-out','Other Keys')]}
  const manager=new MidiConnectionManager({adapter,onMessage:data=>messages.push(data),onRelease:id=>releases.push(id),savePreferences:p=>saved=p})
  await manager.connect();assert.equal(manager.getStatus().selectedOutputId,'lumi-out')
  manager.selectInput('other');assert.equal(manager.getStatus().selectedOutputId,'other-out')
  adapter.emit({type:'message',inputId:'other',data:[0x92,67,99]})
  adapter.emit({type:'ports',inputs:[input()],outputs:[output()]})
  assert.deepEqual(releases,['other']);assert.deepEqual(messages.at(-1),[0x82,67,0])
  adapter.emit({type:'ports',inputs:[input(),input('new-id','Other Keys')],outputs:[output(),output('new-out','Other Keys')]})
  assert.equal(manager.getStatus().selectedInputId,'new-id');assert.equal(manager.getStatus().selectedOutputId,'new-out');assert.equal(saved.input.id,'other')
  manager.selectInput('');adapter.emit({type:'ports',inputs:[input()],outputs:[output()]});assert.equal(manager.getStatus().selectedInputId,null)
})
test('disconnect and disposal invalidate late asynchronous connect completions', async () => {
  for(const dispose of [false,true]){
    const adapter=new FakeAdapter(),pending=deferred()
    adapter.connect=async()=>pending.promise
    const manager=new MidiConnectionManager({adapter,onMessage(){throw new Error('late message reached engine')}})
    const connecting=manager.connect();if(dispose)manager.dispose();else manager.disconnect()
    pending.resolve(adapter.result);assert.equal(await connecting,false)
    adapter.emit({type:'message',inputId:'lumi-in',data:[0x90,60,100]})
    assert.equal(manager.getStatus().selectedInputId,null);assert.equal(manager.getStatus().phase,'idle')
  }
})
test('missing manually chosen output falls back only to paired hardware and never an unrelated synth',async()=>{
 const adapter=new FakeAdapter(),manager=new MidiConnectionManager({adapter,onMessage(){}})
 await manager.connect();manager.selectOutput('lumi-out')
 adapter.emit({type:'ports',inputs:[input()],outputs:[output('other-synth','Other Software Synth')]})
 assert.equal(manager.getStatus().selectedOutputId,null)
 adapter.emit({type:'ports',inputs:[input()],outputs:[output('new-output','ROLI LUMI Keys')]})
 assert.equal(manager.getStatus().selectedOutputId,'new-output')
})
test('MIDI stream parser handles chunks, running status, realtime and system common status reset', () => {
  const parser=new MidiStreamParser()
  assert.deepEqual(parser.push([0x92,60]),[])
  assert.deepEqual(parser.push([0xf8,100,61,101,0xf1,0x01,62,102]),[[0xf8],[0x92,60,100],[0x92,61,101],[0xf1,1]])
  assert.deepEqual(parser.push([0xf0,1,2]),[])
  assert.deepEqual(parser.push([0xfe,3,0xf7]),[[0xfe],[0xf0,1,2,3,0xf7]])
  assert.deepEqual(parser.push([0x90,60,NaN,100,0x90,64,120]),[[0x90,64,120]])
  const bounded=new MidiStreamParser(3);assert.deepEqual(bounded.push([0xf0,1,2,3,4,0xf7,0x90,65,90]),[[0x90,65,90]])
})
class FakePort extends EventTarget {id;name;manufacturer='ROLI';state='connected';connection='closed';closed=0;opens=0
 constructor(id,name='ROLI LUMI Keys'){super();this.id=id;this.name=name}
 async open(){this.opens++;this.connection='open';return this}
 async close(){this.closed++;this.connection='closed';return this} send(){}
 message(data){const event=new Event('midimessage');event.data=new Uint8Array(data);this.dispatchEvent(event)}
}
class FakeAccess extends EventTarget {inputs=new Map();outputs=new Map();sysexEnabled=false}
test('Web MIDI startup never requests ungranted permission; explicit connect asks notes only',async()=>{
  let permission='prompt';const requests=[];const access=new FakeAccess(),port=new FakePort('lumi-in');access.inputs.set(port.id,port)
  const nav={permissions:{query:async()=>({state:permission})},requestMIDIAccess:async options=>{requests.push(options);return access}}
  const adapter=new WebMidiAdapter(nav),messages=[]
  const manager=new MidiConnectionManager({adapter,onMessage:data=>messages.push(data)})
  assert.equal(await manager.init(),false);assert.equal(requests.length,0)
  assert.equal(await manager.connect(),true);assert.deepEqual(requests,[{sysex:false}])
  for(let i=0;i<5;i++)access.dispatchEvent(new Event('statechange'))
  port.message([0x90,60,127]);assert.equal(messages.length,1)
  port.state='disconnected';access.dispatchEvent(new Event('statechange'));assert.equal(manager.getStatus().inputs.length,0)
  port.message([0x90,62,127]);assert.equal(messages.filter(m=>m[0]===0x90).length,1)
  manager.disconnect();assert.ok(port.closed>=1)
  permission='granted';assert.equal(await manager.init(),true);assert.equal(requests.length,2)
})
test('Web adapter discards access resolving after disconnect without installing listeners',async()=>{
 const pending=deferred(),access=new FakeAccess(),port=new FakePort('lumi-in');access.inputs.set(port.id,port)
 const adapter=new WebMidiAdapter({requestMIDIAccess:()=>pending.promise});const events=[];adapter.subscribe(e=>events.push(e))
 const connecting=adapter.connect({sysex:false,restoreOnly:false});adapter.disconnect();pending.resolve(access)
 assert.equal((await connecting).granted,false);port.message([0x90,60,100]);access.dispatchEvent(new Event('statechange'));assert.equal(events.length,0)
})
test('canceling a first request cannot replace a newer successful Web connection',async()=>{
 const old=deferred(),first=new FakeAccess(),second=new FakeAccess(),port=new FakePort('new-input');second.inputs.set(port.id,port)
 let calls=0;const adapter=new WebMidiAdapter({requestMIDIAccess:()=>++calls===1?old.promise:Promise.resolve(second)}), messages=[]
 const manager=new MidiConnectionManager({adapter,onMessage:data=>messages.push(data)})
 const stale=manager.connect();manager.disconnect();assert.equal(await manager.connect(),true)
 old.resolve(first);assert.equal(await stale,false);assert.equal(manager.getStatus().selectedInputId,'new-input')
 port.message([0x90,60,100]);assert.deepEqual(messages,[[0x90,60,100]])
})
test('optional Web permission rejection retains one live listener on original access',async()=>{
 const access=new FakeAccess(),port=new FakePort('lumi-in');access.inputs.set(port.id,port)
 const adapter=new WebMidiAdapter({requestMIDIAccess:async options=>{if(options.sysex)throw new DOMException('Optional permission denied','NotAllowedError');return access}}),messages=[]
 const manager=new MidiConnectionManager({adapter,onMessage:data=>messages.push(data)})
 await manager.connect();assert.equal(await manager.enableLights(),false)
 access.dispatchEvent(new Event('statechange'));port.message([0x90,64,90]);assert.deepEqual(messages,[[0x90,64,90]])
 assert.equal(manager.getStatus().selectedInputId,'lumi-in');assert.equal(port.closed,0)
})
const nextTurn=()=>new Promise(resolve=>setImmediate(resolve))
test('selected Web input open rejection is visible and explicit reconnect recovers',async()=>{
 const access=new FakeAccess(),port=new FakePort('lumi-in'),other=new FakePort('other','Other keyboard');access.inputs.set(port.id,port);access.inputs.set(other.id,other)
 let busy=true
 port.open=async()=>{port.opens++;if(busy)throw new DOMException('Port held by another app','InvalidAccessError');port.connection='open';return port}
 const adapter=new WebMidiAdapter({requestMIDIAccess:async()=>access}),messages=[]
 const manager=new MidiConnectionManager({adapter,onMessage:data=>messages.push(data)})
 await manager.connect();await nextTurn();assert.equal(manager.getStatus().phase,'error');assert.match(manager.getStatus().error,/held by another app/)
 assert.equal(other.opens,0);port.message([0x90,60,100]);assert.equal(messages.length,0)
 busy=false;await manager.connect();await nextTurn();assert.equal(manager.getStatus().phase,'connected');assert.equal(manager.getStatus().error,null);assert.equal(port.opens,2)
 port.message([0x90,60,100]);assert.deepEqual(messages,[[0x90,60,100]])
 manager.disconnect();assert.deepEqual(messages.at(-1),[0x80,60,0])
})
test('changing selected Web input cancels late opens and never attaches duplicate listeners',async()=>{
 const access=new FakeAccess(),a=new FakePort('lumi-in'),b=new FakePort('other','Other keyboard'),pending=deferred();access.inputs.set(a.id,a);access.inputs.set(b.id,b)
 a.open=async()=>{a.opens++;await pending.promise;a.connection='open';return a}
 const adapter=new WebMidiAdapter({requestMIDIAccess:async()=>access}),messages=[]
 const manager=new MidiConnectionManager({adapter,onMessage:data=>messages.push(data)})
 await manager.connect();assert.equal(manager.getStatus().phase,'connecting');assert.equal(b.opens,0)
 manager.selectInput('other');await nextTurn();assert.equal(manager.getStatus().phase,'connected');assert.equal(b.opens,1)
 pending.resolve();await nextTurn();a.message([0x90,60,100]);b.message([0x90,64,100]);assert.deepEqual(messages,[[0x90,64,100]])
 for(let i=0;i<4;i++)access.dispatchEvent(new Event('statechange'))
 b.message([0x80,64,0]);assert.equal(messages.length,2);assert.equal(b.opens,1);assert.equal(a.connection,'closed')
})
test('disconnect during selected Web open ignores rejection and cleans a late successful open',async()=>{
 for(const reject of [false,true]){
  const access=new FakeAccess(),port=new FakePort('lumi-in'),pending=deferred();access.inputs.set(port.id,port)
  port.open=async()=>{await pending.promise;if(reject)throw new DOMException('Late failure','InvalidAccessError');port.connection='open';return port}
  const adapter=new WebMidiAdapter({requestMIDIAccess:async()=>access}),messages=[]
  const manager=new MidiConnectionManager({adapter,onMessage:data=>messages.push(data)})
  await manager.connect();manager.disconnect();pending.resolve();await nextTurn()
  assert.equal(manager.getStatus().phase,'idle');assert.equal(manager.getStatus().error,null);port.message([0x90,60,100]);assert.equal(messages.length,0);assert.equal(port.connection,'closed')
 }
})
test('manager removes disconnected ports and handles explicit disconnect note cleanup',async()=>{
 const adapter=new FakeAdapter(),messages=[],releases=[]
 adapter.result.inputs.push({...input('ghost'),state:'disconnected'})
 const manager=new MidiConnectionManager({adapter,onMessage:data=>messages.push(data),onRelease:id=>releases.push(id)})
 await manager.connect();assert.equal(manager.getStatus().inputs.length,1)
 adapter.emit({type:'message',inputId:'lumi-in',data:[0x95,60,100]})
 manager.disconnect();assert.deepEqual(messages.at(-1),[0x85,60,0]);assert.deepEqual(releases,['lumi-in'])
 adapter.emit({type:'ports',inputs:[input()],outputs:[output()]});assert.equal(manager.getStatus().inputs.length,0)
})
test('disconnect also cancels external connections still waiting for async setup',()=>{
 const adapter=new FakeAdapter(),manager=new MidiConnectionManager({adapter,onMessage(){}});let canceled=0
 manager.addDisconnectCleanup(()=>canceled++);manager.disconnect();manager.disconnect();assert.equal(canceled,1)
})
function nativeEvent(target,detail){const event=new Event('soundlab-midi');event.detail=detail;target.dispatchEvent(event)}
test('native installs listener before synchronous start response and validates chunk events',async()=>{
  const target=new EventTarget(),posts=[],messages=[]
  const adapter=new NativeMidiAdapter({events:target,post:message=>{posts.push(message);if(message.action==='start')nativeEvent(target,{type:'ports',inputs:[input('native-in')],outputs:[output('native-out')]})}})
  const manager=new MidiConnectionManager({adapter,onMessage:data=>messages.push(data)})
  await manager.init();assert.equal(manager.getStatus().selectedInputId,'native-in');assert.equal(posts.length,1)
  await manager.connect();await manager.connect();assert.equal(posts.length,3)
  nativeEvent(target,{type:'message',inputId:'native-in',data:[0x90,60]})
  nativeEvent(target,{type:'message',inputId:'native-in',data:[0xf8,127,61,100]})
  nativeEvent(target,{type:'message',inputId:'unknown',data:[0x90,62,100]})
  nativeEvent(target,{type:'message',inputId:'native-in',data:[Infinity]})
  assert.deepEqual(messages,[[0xf8],[0x90,60,127],[0x90,61,100]])
  manager.send('native-out',[0x90,60,120],123);assert.deepEqual(posts.at(-1),{action:'send',id:'native-out',data:[0x90,60,120],timestamp:123})
  nativeEvent(target,{type:'ports',inputs:[],outputs:[]});assert.equal(manager.getStatus().phase,'waiting')
  manager.disconnect();nativeEvent(target,{type:'ports',inputs:[input('native-in')],outputs:[]});assert.equal(manager.getStatus().inputs.length,0)
})
test('native failure survives emptyports and explicit connect retries without duplicate listeners',async()=>{
 const target=new EventTarget(),messages=[];let starts=0
 const adapter=new NativeMidiAdapter({events:target,post:message=>{
  if(message.action!=='start')return
  starts++
  if(starts===1){nativeEvent(target,{type:'error',message:'Cannot open MIDI keyboard',recoverable:true});nativeEvent(target,{type:'ports',inputs:[],outputs:[]})}
  else nativeEvent(target,{type:'ports',inputs:[input('native-in')],outputs:[]})
 }})
 const manager=new MidiConnectionManager({adapter,onMessage:data=>messages.push(data)})
 await manager.init();assert.equal(manager.getStatus().phase,'error');assert.match(manager.getStatus().error,/Cannot open/)
 await manager.connect();assert.equal(starts,2);assert.equal(manager.getStatus().phase,'connected');assert.equal(manager.getStatus().error,null)
 nativeEvent(target,{type:'message',inputId:'native-in',data:[0x90,60,100]});assert.equal(messages.length,1)
})
test('native background ports close releases held notes and foreground ports restores selection',async()=>{
 const target=new EventTarget(),releases=[]
 const adapter=new NativeMidiAdapter({events:target,post:message=>{if(message.action==='start')nativeEvent(target,{type:'ports',inputs:[input('native-in')],outputs:[output('native-out')]})}})
 const manager=new MidiConnectionManager({adapter,onMessage(){},onRelease:id=>releases.push(id)})
 await manager.init();nativeEvent(target,{type:'message',inputId:'native-in',data:[0x90,60,100]})
 nativeEvent(target,{type:'ports',inputs:[],outputs:[]});assert.equal(manager.getStatus().phase,'waiting');assert.deepEqual(releases,['native-in'])
 nativeEvent(target,{type:'ports',inputs:[input('native-in')],outputs:[output('native-out')]});assert.equal(manager.getStatus().selectedInputId,'native-in');assert.equal(manager.getStatus().phase,'connected')
})
