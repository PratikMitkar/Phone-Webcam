import assert from 'node:assert/strict'
import test from 'node:test'
import { summarize } from './stats.js'

const report = (video) =>
  new Map([
    ['v', { type: 'inbound-rtp', kind: 'video', codecId: 'c', ...video }],
    ['c', { type: 'codec', mimeType: 'video/H264' }],
    ['p', { type: 'candidate-pair', nominated: true, state: 'succeeded', currentRoundTripTime: 0.004 }],
  ])

test('rates cover only the interval since the previous sample', () => {
  const first = summarize(
    report({ timestamp: 1000, bytesReceived: 1_000_000, jitterBufferDelay: 9, jitterBufferEmittedCount: 100, totalDecodeTime: 5, framesDecoded: 100 }),
  )
  const second = summarize(
    report({ timestamp: 2000, bytesReceived: 2_000_000, jitterBufferDelay: 9.6, jitterBufferEmittedCount: 130, totalDecodeTime: 5.09, framesDecoded: 130 }),
    first,
  )

  assert.equal(first.kbps, 0)
  assert.equal(second.kbps, 8000)
  assert.equal(second.codec, 'H264')
  assert.equal(Math.round(second.bufferMs), 20)
  assert.equal(Math.round(second.decodeMs), 3)
  assert.equal(Math.round(second.receiveDelayMs), 25) // 4 ms round trip / 2 + 20 + 3
})

test('no video yet', () => {
  assert.equal(summarize(new Map()), null)
})
