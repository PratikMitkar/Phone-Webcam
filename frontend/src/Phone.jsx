import { Camera, Mic, MicOff, Square, SwitchCamera } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { connect } from './signal.js'

const DEFAULTS = {
  facingMode: 'environment',
  deviceId: null,
  width: 1280,
  height: 720,
  frameRate: 60, // every stage of the pipeline waits about one frame, so more frames = less delay
  zoom: null,
  torch: null,
  mic: true,
  bitrate: 8000, // kbps
}

export default function Phone() {
  const preview = useRef(null)
  const cam = useRef({ config: { ...DEFAULTS }, stream: null, pc: null, signal: null, peerPresent: false }).current
  const [started, setStarted] = useState(false)
  const [status, setStatus] = useState('waiting for PC')
  const [error, setError] = useState('')
  const [config, setConfig] = useState(cam.config)

  const videoTrack = () => cam.stream?.getVideoTracks()[0]

  async function openCamera() {
    // iOS cannot open a second camera while the first is still running.
    cam.stream?.getTracks().forEach((track) => track.stop())
    const { deviceId, facingMode, width, height, frameRate } = cam.config
    const video = {
      ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode }),
      width: { ideal: width },
      height: { ideal: height },
      frameRate: { ideal: frameRate },
    }
    try {
      cam.stream = await navigator.mediaDevices.getUserMedia({ video, audio: true })
    } catch {
      cam.stream = await navigator.mediaDevices.getUserMedia({ video }) // microphone denied or missing
    }
    cam.stream.getAudioTracks().forEach((track) => (track.enabled = cam.config.mic))
    cam.stream.getVideoTracks()[0].contentHint = 'motion' // encoder favours smooth, prompt frames
    preview.current.srcObject = cam.stream
    for (const track of cam.stream.getTracks()) {
      await cam.pc?.getSenders().find((sender) => sender.track?.kind === track.kind)?.replaceTrack(track)
    }
  }

  async function applyVideo() {
    const { width, height, frameRate, zoom, torch } = cam.config
    const advanced = {}
    if (zoom != null) advanced.zoom = zoom
    if (torch != null) advanced.torch = torch
    await videoTrack().applyConstraints({
      width: { ideal: width },
      height: { ideal: height },
      frameRate: { ideal: frameRate },
      ...(Object.keys(advanced).length && { advanced: [advanced] }),
    })
  }

  async function applyBitrate() {
    const sender = cam.pc?.getSenders().find((s) => s.track?.kind === 'video')
    const parameters = sender?.getParameters()
    if (!parameters?.encodings?.length) return
    parameters.encodings[0].maxBitrate = cam.config.bitrate * 1000
    // When the phone or Wi-Fi cannot keep up, lower the sharpness, never let frames queue up.
    parameters.degradationPreference = 'maintain-framerate'
    await sender.setParameters(parameters)
  }

  // Tells the PC what this camera can do, so it can draw the matching controls.
  async function report() {
    const track = videoTrack()
    const devices = (await navigator.mediaDevices.enumerateDevices())
      .filter((device) => device.kind === 'videoinput')
      .map(({ deviceId, label }) => ({ deviceId, label }))
    const { zoom, torch } = track.getCapabilities?.() ?? {}
    cam.signal?.send({
      type: 'state',
      devices,
      capabilities: { zoom, torch },
      settings: track.getSettings(),
      config: cam.config,
    })
    setConfig({ ...cam.config })
  }

  async function control(set) {
    try {
      setError('')
      Object.assign(cam.config, set)
      if ('deviceId' in set || 'facingMode' in set) {
        if ('facingMode' in set) cam.config.deviceId = null
        Object.assign(cam.config, { zoom: null, torch: null })
        await openCamera()
      } else if ('mic' in set) {
        cam.stream.getAudioTracks().forEach((track) => (track.enabled = set.mic))
      } else if ('bitrate' in set) {
        await applyBitrate()
      } else {
        await applyVideo()
      }
    } catch (e) {
      setError(String(e))
    }
    await report()
  }

  // The phone always makes the offer, because it owns the camera tracks.
  async function call() {
    cam.pc?.close()
    const pc = (cam.pc = new RTCPeerConnection()) // same Wi-Fi: no STUN/TURN server needed
    // One stream per track: tracks in the same stream are lip-synced by the receiver,
    // which holds the picture back until the (slower) sound is ready.
    cam.stream.getTracks().forEach((track) => pc.addTrack(track, new MediaStream([track])))
    pc.onicecandidate = (event) => event.candidate && cam.signal.send({ type: 'candidate', candidate: event.candidate })
    pc.onconnectionstatechange = () => {
      setStatus(pc.connectionState)
      // Wi-Fi dropped for too long: start over as soon as the PC is still there.
      if (pc.connectionState === 'failed' && cam.peerPresent) call().catch(console.error)
    }
    await pc.setLocalDescription(await pc.createOffer())
    cam.signal.send({ type: 'offer', sdp: pc.localDescription })
  }

  async function onMessage(message) {
    if (message.type === 'peer-joined') {
      cam.peerPresent = true
      await call()
      await report()
    } else if (message.type === 'answer') {
      await cam.pc.setRemoteDescription(message.sdp)
      await applyBitrate()
    } else if (message.type === 'candidate') {
      await cam.pc?.addIceCandidate(message.candidate)
    } else if (message.type === 'control') {
      await control(message.set)
    } else if (message.type === 'peer-left') {
      cam.peerPresent = false
      setStatus('waiting for PC')
    }
  }

  function stop() {
    cam.signal?.send({ type: 'bye' })
    cam.signal?.close()
    cam.pc?.close()
    cam.stream?.getTracks().forEach((track) => track.stop())
    Object.assign(cam, { stream: null, pc: null, signal: null, peerPresent: false })
    preview.current.srcObject = null
    setStatus('waiting for PC')
    setStarted(false)
  }

  async function start() {
    try {
      setError('')
      await openCamera()
      cam.signal = connect('phone', onMessage)
      setStarted(true)
    } catch (e) {
      setError(String(e))
    }
  }

  // Keep the screen on: the browser stops the camera when the phone locks.
  useEffect(() => {
    if (!started) return
    let lock
    const keepAwake = async () => {
      if (document.visibilityState === 'visible') lock = await navigator.wakeLock?.request('screen').catch(() => {})
    }
    keepAwake()
    document.addEventListener('visibilitychange', keepAwake)
    return () => {
      document.removeEventListener('visibilitychange', keepAwake)
      lock?.release()
    }
  }, [started])

  // Leaving the page releases the camera.
  useEffect(
    () => () => {
      cam.signal?.close()
      cam.pc?.close()
      cam.stream?.getTracks().forEach((track) => track.stop())
    },
    [cam],
  )

  if (!navigator.mediaDevices) {
    return (
      <div className="phone">
        <p className="notice">
          The camera only works over HTTPS. Open the <b>https://</b> link from the QR code on the PC, and accept the
          certificate warning.
        </p>
      </div>
    )
  }

  const live = status === 'connected'
  return (
    <div className="phone">
      <video ref={preview} autoPlay playsInline muted />
      {started && (
        <span className="tag phone-status">
          <span className={`dot ${live ? 'live' : ''}`} />
          {live ? 'LIVE' : status}
        </span>
      )}
      {error && <p className="notice error">{error}</p>}
      <div className="phone-bar">
        {started ? (
          <>
            <button
              type="button"
              className="btn secondary"
              onClick={() => control({ facingMode: config.facingMode === 'user' ? 'environment' : 'user' })}
            >
              <SwitchCamera size={18} />
              Flip
            </button>
            <button type="button" className={`btn ${config.mic ? '' : 'secondary'}`} onClick={() => control({ mic: !config.mic })}>
              {config.mic ? <Mic size={18} /> : <MicOff size={18} />}
              Mic
            </button>
            <button type="button" className="btn danger" onClick={stop}>
              <Square size={16} />
              Stop
            </button>
          </>
        ) : (
          <button type="button" className="btn" onClick={start}>
            <Camera size={18} />
            Start camera
          </button>
        )}
      </div>
    </div>
  )
}
