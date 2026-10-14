import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
const root=fileURLToPath(new URL('../../',import.meta.url))
async function bundle(contents,stubFilter,stubContents){
 const built=await build({stdin:{contents,resolveDir:root,sourcefile:'MidiRegressionHarness.ts',loader:'ts'},bundle:true,write:false,format:'esm',platform:'node',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'mock-midi-io-only',setup(build){build.onResolve({filter:stubFilter},()=>({path:'isolated-dependency',namespace:'mock'}));build.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:stubContents,loader:'js'}))}}]})
 return import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`)
}
const real=await bundle(`export { engine } from './src/audio/engine'; export { getState,setState,setUI,makeTrack } from './src/state/store'; export { midiCalls } from '__midi_stub__'`,/(?:\/midi\/midi$|^__midi_stub__$)/,`
export const midiCalls=[];
export const MIDI_CLOCK=248,MIDI_CONTINUE=251,MIDI_START=250,MIDI_STOP=252;
export function registerMidiActions(){};
export function sendNoteOn(...args){midiCalls.push(['on',...args])};
export function sendNoteOff(...args){midiCalls.push(['off',...args])};
export function sendControlChange(){};export function sendProgramChange(){};export function sendRealtime(){};
`)
const base=structuredClone(real.getState())
function engineFixture({recording=false}={}){
 let beat=2
 const a={...real.makeTrack('synth','A'),id:'a',midiOutId:'original-out',midiOutChannel:3,clips:[{id:'take-a',kind:'midi',name:'Take',start:0,length:4,notes:[]}]}
 const b={...real.makeTrack('synth','B'),id:'b'}
 const voices=[],offs=[],blankets=[]
 function instrument(track){return {noteOn(pitch,vel,time,channel){voices.push({track,pitch,channel,held:true})},noteOff(pitch,time,channel){offs.push({track,pitch,channel});const voice=voices.find(v=>v.track===track&&v.pitch===pitch&&v.channel===channel&&v.held);if(voice)voice.held=false},allNotesOff(){blankets.push(track)}}}
 const channels=new Map([['a',{trackId:'a',instrument:instrument('a')}],['b',{trackId:'b',instrument:instrument('b')}]])
 const engine=real.engine;engine.ctx={currentTime:10};engine.ensure=()=>engine.ctx;engine.channels=channels;engine.liveVoices=new Map();engine.pendingRecNotes=new Map();engine.recordClipByTrack=new Map([['a','take-a']]);engine.transport={playing:true,currentBeat:()=>beat}
 real.midiCalls.length=0;real.setState({project:{...structuredClone(base.project),tracks:[a,b]},ui:{...base.ui,selectedTrackId:'a',recording}})
 return {engine,voices,offs,blankets,setBeat:value=>beat=value,select:id=>real.setUI({selectedTrackId:id})}
}
test('real engine releases original instrument and output after selected track and routing change',()=>{
 const f=engineFixture();f.engine.liveNoteOn(60,0.7,5);f.select('b')
 real.setState({project:{...real.getState().project,tracks:real.getState().project.tracks.map(t=>t.id==='a'?{...t,midiOutId:'replacement-out',midiOutChannel:8}:t)}})
 f.engine.liveNoteOff(60,5)
 assert.deepEqual(f.offs,[{track:'a',pitch:60,channel:5}]);assert.equal(f.voices.some(v=>v.held),false)
 assert.deepEqual(real.midiCalls,[['on','original-out',3,60,0.7],['off','original-out',3,60]])
})
test('real engine hotplug release commits a held recorded note to original clip',()=>{
 const f=engineFixture({recording:true});f.engine.liveNoteOn(64,0.8,2);f.select('b');f.setBeat(5);f.engine.releaseLiveNotes()
 const note=real.getState().project.tracks.find(t=>t.id==='a').clips[0].notes[0]
 assert.equal(note.pitch,64);assert.equal(note.start,2);assert.equal(note.dur,3);assert.equal(note.vel,0.8)
 assert.equal(f.engine.pendingRecNotes.size,0);assert.equal(f.engine.liveVoices.size,0);assert.deepEqual(f.blankets,[])
})
test('real engine does not leave an untracked duplicate live voice after repeated same-note input',()=>{
 const f=engineFixture();f.engine.liveNoteOn(60,0.7,0);f.engine.liveNoteOn(60,0.9,0);f.engine.releaseLiveNotes()
 assert.equal(f.voices.filter(v=>v.held).length,0)
})
const midi=await bundle(`export {handleMidiMessage,startMidiLearn,cancelMidiLearn,registerMidiActions} from './src/midi/midi';export {setUI} from './src/state/store';export {getSettings,updateSettings} from './src/state/settings';export {engineCalls} from '__engine_stub__'`,/(?:\/audio\/engine$|^__engine_stub__$)/,`
export const engineCalls=[];
export const engine={liveNoteOn(...args){engineCalls.push(['on',...args])},liveNoteOff(...args){engineCalls.push(['off',...args])},releaseLiveNotes(){engineCalls.push(['release'])},livePitchBend(){},livePressure(){},liveTimbre(){}};
`)
test('real MIDI handler releases the original MPE voice after mode toggle and validates malformed notes',()=>{
 midi.engineCalls.length=0;midi.setUI({mpeEnabled:true});midi.handleMidiMessage([0x95,60,100]);midi.setUI({mpeEnabled:false});midi.handleMidiMessage([0x85,60,0])
 assert.deepEqual(midi.engineCalls,[['on',60,100/127,5],['off',60,5]])
 midi.handleMidiMessage([0x90,128,90]);midi.handleMidiMessage([0x90,60]);assert.equal(midi.engineCalls.length,2)
})
test('real MIDI handler preserves MIDI learn and mapped transport actions',async()=>{
 midi.updateSettings({midiMap:{}});let triggered=0;midi.registerMidiActions({playStop:()=>triggered++})
 const learned=midi.startMidiLearn('playStop');midi.handleMidiMessage([0xc0,12]);assert.equal(await learned,'pc:12')
 midi.handleMidiMessage([0xc0,12]);assert.equal(triggered,1);assert.equal(midi.getSettings().midiMap['pc:12'],'playStop');midi.cancelMidiLearn()
})
