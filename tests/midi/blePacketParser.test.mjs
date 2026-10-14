import test from 'node:test'
import assert from 'node:assert/strict'
import { BleMidiPacketParser, encodeBleMidi } from '../../src/midi/blePacketParser.ts'
test('BLE timestamp stripping, packet-local running status and realtime preserve notes',()=>{
 const parser=new BleMidiPacketParser()
 assert.deepEqual(parser.push(Uint8Array.from([0x80,0x80,0x90,60,100,61,101,0x81,0x80,60,0])),[[0x90,60,100],[0x90,61,101],[0x80,60,0]])
 assert.deepEqual(parser.push(Uint8Array.from([0x80,0x80,0x92,64,0x81,0xf8,100])),[[0xf8],[0x92,64,100]])
 assert.deepEqual(parser.push(Uint8Array.from([0x80,0x80,62,127])),[])
})
test('BLE SysEx continues without timestamp across packets and realtime is separate',()=>{
 const parser=new BleMidiPacketParser()
 assert.deepEqual(parser.push(Uint8Array.from([0x80,0x80,0xf0,1,2])),[])
 assert.deepEqual(parser.push(Uint8Array.from([0x80,3,4,0x81,0xf8,5,0x82,0xf7])),[[0xf8],[0xf0,1,2,3,4,5,0xf7]])
})
test('BLE SysEx transmit packets roundtrip at default20byte ATT payload',()=>{
 for(const size of [0,1,15,16,17,18,19,34,35,55,100]){
  const raw=[0xf0,...Array.from({length:size},(_,i)=>i%128),0xf7], parser=new BleMidiPacketParser()
  const packets=encodeBleMidi(raw,8191)
  assert.ok(packets.length>0,`size ${size}`);assert.ok(packets.every(p=>p.length<=20),`size ${size}`)
  assert.deepEqual(packets.flatMap(p=>parser.push(p)),[raw],`size ${size}`)
 }
})
