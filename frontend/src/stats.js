// Condenses an RTCStatsReport into the few numbers worth showing. Pass the previous
// result to get rates (bitrate, delays) for the interval in between.
export function summarize(report, previous) {
  const stats = [...report.values()]
  const video = stats.find((entry) => entry.type === 'inbound-rtp' && entry.kind === 'video')
  if (!video) return null
  const pair = stats.find((entry) => entry.type === 'candidate-pair' && entry.nominated && entry.state === 'succeeded')
  const before = previous?.sample ?? {}

  const seconds = (video.timestamp - before.timestamp) / 1000
  const delta = (key) => (video[key] ?? 0) - (before[key] ?? 0)
  // Average milliseconds per frame over the interval, from two running totals.
  const perFrame = (total, count) => (delta(count) > 0 ? (delta(total) / delta(count)) * 1000 : 0)

  const rttMs = (pair?.currentRoundTripTime ?? 0) * 1000
  const bufferMs = perFrame('jitterBufferDelay', 'jitterBufferEmittedCount')
  const decodeMs = perFrame('totalDecodeTime', 'framesDecoded')
  return {
    sample: video,
    width: video.frameWidth ?? 0,
    height: video.frameHeight ?? 0,
    fps: video.framesPerSecond ?? 0,
    kbps: seconds > 0 ? (delta('bytesReceived') * 8) / 1000 / seconds : 0,
    codec: report.get(video.codecId)?.mimeType?.split('/')[1] ?? '',
    packetsLost: video.packetsLost ?? 0,
    framesDropped: video.framesDropped ?? 0,
    rttMs,
    bufferMs,
    decodeMs,
    // Network one way + waiting in the buffer + decoding. The phone's capture and
    // encode time and the monitor's refresh are not visible from here.
    receiveDelayMs: rttMs / 2 + bufferMs + decodeMs,
  }
}
