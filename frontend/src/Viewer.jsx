import {
  Camera,
  Circle,
  Flashlight,
  FlipHorizontal2,
  ImageDown,
  Maximize,
  Mic,
  MicOff,
  MonitorPlay,
  PictureInPicture2,
  RotateCw,
  Scaling,
  Square,
  SwitchCamera,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { connect } from './signal.js'
import { summarize } from './stats.js'

const params = new URLSearchParams(location.search)
const CLEAN = params.has('clean') // video only, for OBS or window capture
const RESOLUTIONS = [
  [640, 360],
  [1280, 720],
  [1920, 1080],
  [3840, 2160],
]

function download(blob, extension) {
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = `webcam-${new Date().toISOString().replace(/[:.]/g, '-')}.${extension}`
  link.click()
  setTimeout(() => URL.revokeObjectURL(link.href), 1000)
}

export default function Viewer() {
  const video = useRef(null)
  const audio = useRef(null)
  const stage = useRef(null)
  const rtc = useRef({ pc: null, signal: null }).current
  const [phoneUrls, setPhoneUrls] = useState([])
  const [phoneUrl, setPhoneUrl] = useState('')
  const [stats, setStats] = useState(null)
  const [phone, setPhone] = useState(null) // latest state reported by the phone
  const [status, setStatus] = useState('waiting for phone')
  const [view, setView] = useState({ mirror: false, rotate: 0, cover: CLEAN, muted: !params.has('audio') })
  const [recorder, setRecorder] = useState(null)

  useEffect(() => {
    fetch('/api/info')
      .then((response) => (response.ok ? response.json() : {}))
      .then((info) => {
        setPhoneUrls(info.phoneUrls ?? [])
        setPhoneUrl(info.phoneUrls?.[0] ?? '')
      })
      .catch(() => {})

    rtc.signal = connect('viewer', async (message) => {
      if (message.type === 'offer') {
        rtc.pc?.close()
        const pc = (rtc.pc = new RTCPeerConnection())
        pc.ontrack = (event) => {
          // Show each frame as soon as it arrives instead of buffering for smoothness.
          event.receiver.jitterBufferTarget = 0
          event.receiver.playoutDelayHint = 0 // older Chrome
          // Picture and sound play in separate elements, so the picture never waits for the sound.
          const element = event.track.kind === 'video' ? video.current : audio.current
          element.srcObject = event.streams[0]
          element.play().catch(() => {}) // sound stays blocked until the page is clicked
        }
        pc.onicecandidate = (event) =>
          event.candidate && rtc.signal.send({ type: 'candidate', candidate: event.candidate })
        pc.onconnectionstatechange = () => setStatus(pc.connectionState)
        await pc.setRemoteDescription(message.sdp)
        await pc.setLocalDescription(await pc.createAnswer())
        rtc.signal.send({ type: 'answer', sdp: pc.localDescription })
      } else if (message.type === 'candidate') {
        await rtc.pc?.addIceCandidate(message.candidate)
      } else if (message.type === 'state') {
        setPhone(message)
      } else if (message.type === 'peer-left' || message.type === 'bye') {
        rtc.pc?.close()
        video.current.srcObject = null
        audio.current.srcObject = null
        setStatus('waiting for phone')
        setPhone(null)
      }
    })
    return () => {
      rtc.signal.close()
      rtc.pc?.close()
    }
  }, [rtc])

  useEffect(() => {
    if (status !== 'connected') return setStats(null)
    let previous = null
    const timer = setInterval(async () => {
      previous = summarize(await rtc.pc.getStats(), previous)
      setStats(previous)
    }, 1000)
    return () => clearInterval(timer)
  }, [status, rtc])

  useEffect(() => {
    audio.current.muted = view.muted
    if (!view.muted) audio.current.play().catch(() => {})
  }, [view.muted])

  const control = (set) => rtc.signal.send({ type: 'control', set })
  const toggle = (key) => setView((current) => ({ ...current, [key]: !current[key] }))

  function snapshot() {
    const element = video.current
    const canvas = document.createElement('canvas')
    canvas.width = element.videoWidth
    canvas.height = element.videoHeight
    canvas.getContext('2d').drawImage(element, 0, 0)
    canvas.toBlob((blob) => download(blob, 'png'))
  }

  function toggleRecording() {
    if (recorder) {
      recorder.stop()
      setRecorder(null)
      return
    }
    // ponytail: whole recording is held in memory until stopped; stream chunks to disk
    // (File System Access API) if recordings get long.
    const chunks = []
    const tracks = rtc.pc.getReceivers().map((receiver) => receiver.track)
    const next = new MediaRecorder(new MediaStream(tracks))
    next.ondataavailable = (event) => chunks.push(event.data)
    next.onstop = () => download(new Blob(chunks, { type: next.mimeType }), 'webm')
    next.start()
    setRecorder(next)
  }

  const { devices = [], capabilities = {}, settings = {}, config = {} } = phone ?? {}
  const live = status === 'connected' && !!phone

  const sideways = view.rotate % 180 !== 0
  const videoStyle = {
    width: sideways ? '100cqh' : '100cqw',
    height: sideways ? '100cqw' : '100cqh',
    objectFit: view.cover ? 'cover' : 'contain',
    transform: `translate(-50%, -50%) rotate(${view.rotate}deg) scaleX(${view.mirror ? -1 : 1})`,
  }
  const stageElement = (
    <div className="stage" ref={stage}>
      <video ref={video} autoPlay playsInline muted style={videoStyle} />
      <audio ref={audio} autoPlay />
      {!live && !CLEAN && (
        <div className="stage-empty">
          <Camera size={28} strokeWidth={1.5} />
          <span>{phoneUrl ? 'Scan the QR code with your phone to start' : 'Waiting for the phone'}</span>
        </div>
      )}
    </div>
  )
  if (CLEAN) return <div className="clean">{stageElement}</div>

  const Toggle = ({ on, icon: Icon, children, ...props }) => (
    <button type="button" className={`btn small ${on ? '' : 'secondary'}`} aria-pressed={!!on} {...props}>
      <Icon size={14} />
      {children}
    </button>
  )

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            <Camera size={16} strokeWidth={2} />
          </span>
          <span>Phone Webcam</span>
        </div>
        <div className="sidebar-rule" />

        {live ? (
          <>
            <div className="sidebar-section">Status</div>
            <p className="sidebar-text">
              <span className="dot live" /> Connected · {settings.width}×{settings.height} @ {Math.round(settings.frameRate)} fps
            </p>

            <div className="sidebar-section">Camera</div>
            <div className="sidebar-fields">
              <label className="field">
                <span>Lens</span>
                <select value={settings.deviceId ?? ''} onChange={(event) => control({ deviceId: event.target.value })}>
                  {devices.map((device, index) => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {device.label || `Camera ${index + 1}`}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Resolution</span>
                <select
                  value={config.height}
                  onChange={(event) => {
                    const [width, height] = RESOLUTIONS.find((size) => size[1] === Number(event.target.value))
                    control({ width, height })
                  }}
                >
                  {RESOLUTIONS.map(([width, height]) => (
                    <option key={height} value={height}>
                      {width} × {height}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Frame rate</span>
                <select value={config.frameRate} onChange={(event) => control({ frameRate: Number(event.target.value) })}>
                  {[15, 24, 30, 60].map((fps) => (
                    <option key={fps} value={fps}>
                      {fps} fps
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Quality</span>
                <select value={config.bitrate} onChange={(event) => control({ bitrate: Number(event.target.value) })}>
                  {[1000, 2500, 5000, 8000, 15000, 30000].map((kbps) => (
                    <option key={kbps} value={kbps}>
                      {kbps / 1000} Mbps
                    </option>
                  ))}
                </select>
              </label>
              {capabilities.zoom && (
                <label className="field">
                  <span>Zoom</span>
                  <input
                    key={settings.deviceId}
                    type="range"
                    min={capabilities.zoom.min}
                    max={capabilities.zoom.max}
                    step={capabilities.zoom.step || 0.1}
                    defaultValue={settings.zoom ?? capabilities.zoom.min}
                    onChange={(event) => control({ zoom: Number(event.target.value) })}
                  />
                </label>
              )}
            </div>
            <div className="sidebar-toggles">
              <Toggle
                icon={SwitchCamera}
                onClick={() =>
                  control({ facingMode: (settings.facingMode ?? config.facingMode) === 'user' ? 'environment' : 'user' })
                }
              >
                Flip
              </Toggle>
              <Toggle on={config.mic} icon={config.mic ? Mic : MicOff} onClick={() => control({ mic: !config.mic })}>
                Mic
              </Toggle>
              {capabilities.torch && (
                <Toggle on={config.torch} icon={Flashlight} onClick={() => control({ torch: !config.torch })}>
                  Torch
                </Toggle>
              )}
            </div>

            {stats && (
              <>
                <div className="sidebar-section">Stream</div>
                <div className="sidebar-stats">
                  <div className="stat-row">
                    <span>Delay</span>
                    <span>{Math.round(stats.receiveDelayMs)} ms</span>
                  </div>
                  <div className="stat-row">
                    <span>Received</span>
                    <span>{stats.height}p{Math.round(stats.fps)}</span>
                  </div>
                  <div className="stat-row">
                    <span>Bitrate</span>
                    <span>{(stats.kbps / 1000).toFixed(1)} Mbps</span>
                  </div>
                  <div className="stat-row">
                    <span>Round trip</span>
                    <span>{stats.rttMs.toFixed(0)} ms</span>
                  </div>
                </div>
                <p className="sidebar-detail">
                  {stats.codec} · buf {Math.round(stats.bufferMs)} ms · dec {Math.round(stats.decodeMs)} ms ·{' '}
                  {stats.packetsLost} lost · {stats.framesDropped} dropped
                </p>
              </>
            )}
          </>
        ) : (
          <>
            <div className="sidebar-section">Pair phone</div>
            {phoneUrl ? (
              <>
                <div className="qr">
                  <QRCodeSVG value={phoneUrl} size={208} marginSize={2} />
                </div>
                {phoneUrls.length > 1 && (
                  <label className="field">
                    <span>Network</span>
                    <select value={phoneUrl} onChange={(event) => setPhoneUrl(event.target.value)}>
                      {phoneUrls.map((url) => (
                        <option key={url} value={url}>
                          {new URL(url).hostname}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <p className="sidebar-text">
                  Scan with the phone on the same Wi-Fi, accept the certificate warning, then tap Start camera.
                </p>
              </>
            ) : (
              <p className="sidebar-text">Open this page on the PC running the server to see the pairing code.</p>
            )}
          </>
        )}

        <div className="sidebar-foot">
          <a className="nav-item" href="/?clean">
            <MonitorPlay size={18} strokeWidth={1.75} />
            Video only, for OBS
          </a>
        </div>
      </aside>

      <main className="main">
        <div className="page-card">
          <header className="page-header">
            <div>
              <h1>Live camera</h1>
              <p className="muted">
                <span className={`tag ${live ? 'ok' : ''}`}>
                  <span className={`dot ${live ? 'live' : ''}`} />
                  {live ? 'live' : status}
                </span>
              </p>
            </div>
            <div className="row">
              <button type="button" className="btn secondary" disabled={!live} onClick={snapshot}>
                <ImageDown size={15} />
                Snapshot
              </button>
              <button
                type="button"
                className={`btn ${recorder ? 'danger' : 'secondary'}`}
                disabled={!live && !recorder}
                onClick={toggleRecording}
              >
                {recorder ? <Square size={14} /> : <Circle size={14} />}
                {recorder ? 'Stop recording' : 'Record'}
              </button>
              <button
                type="button"
                className="btn secondary"
                disabled={!live}
                onClick={() => video.current.requestPictureInPicture()}
              >
                <PictureInPicture2 size={15} />
                Pop out
              </button>
              <button type="button" className="btn" onClick={() => stage.current.requestFullscreen()}>
                <Maximize size={15} />
                Fullscreen
              </button>
            </div>
          </header>

          {stageElement}

          <div className="row view-row">
            <Toggle on={view.mirror} icon={FlipHorizontal2} onClick={() => toggle('mirror')}>
              Mirror
            </Toggle>
            <Toggle
              icon={RotateCw}
              onClick={() => setView((current) => ({ ...current, rotate: (current.rotate + 90) % 360 }))}
            >
              Rotate
            </Toggle>
            <Toggle on={view.cover} icon={Scaling} onClick={() => toggle('cover')}>
              Fill
            </Toggle>
            <Toggle on={!view.muted} icon={view.muted ? VolumeX : Volume2} onClick={() => toggle('muted')}>
              Sound
            </Toggle>
          </div>
        </div>
      </main>
    </div>
  )
}
