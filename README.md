# Phone Webcam

Use a phone's camera as a webcam on the PC, over the local Wi-Fi. No app on the phone, only its browser.

## Run

Double-click `start.bat` (needs Java 17+ and Node.js). Then:

1. PC: open http://localhost:8088
2. Phone (same Wi-Fi): scan the QR code, accept the certificate warning, tap **Start camera**.

The video appears on the PC, with the camera controls next to it.

## Use it in Zoom / Meet / Teams

Those apps only see real camera devices, so OBS Studio turns the page into one:

1. OBS → Sources → **Browser** → URL `http://localhost:8088/?clean` (add `&audio` for the phone mic).
   If the picture stays black, use **Window Capture** on a browser window showing that URL instead.
2. OBS → **Start Virtual Camera**, then pick "OBS Virtual Camera" in the meeting app.

## How it works

- `backend/` Spring Boot. Serves the built React app and relays WebRTC signaling messages
  (`/api/events` server-sent events, `/api/send`). Video never passes through it.
- `frontend/` React + Vite. `?role=phone` is the camera page, everything else is the PC viewer.
- Ports: `8443` HTTPS (phone, browsers require HTTPS for camera access), `8088` HTTP (PC).
- `backend/data/` holds the generated self-signed certificate.
- Pairing: devices on the Wi-Fi need the token inside the QR link; the PC itself does not. A new token
  is made on every server start, so scan the QR again after a restart.

## Troubleshooting

- Phone cannot open the page: allow Java through Windows Firewall, and check the Wi-Fi router has no
  "client/AP isolation".
- Router blocks phone-to-PC traffic: turn on Windows **Mobile hotspot**, join it with the phone, then pick the
  hotspot address under **Network** above the QR code.
- Several addresses (hotspot, VPN, virtual adapters): the **Network** selector above the QR code lists them all.
- Camera stops when the phone locks or the browser goes to the background: browser rule, keep the page open.

## Measuring latency

The **Stats** panel shows the receive delay (network + buffer + decode). For the true camera-to-screen
delay, point the phone at a running stopwatch on the PC screen and take a screenshot: the difference
between the two clocks is the full delay.

## Development

Tests: `cd backend && mvnw test`, `cd frontend && npm test`.


`cd backend && mvnw spring-boot:run`, then `cd frontend && npm run dev` (hot reload, `/api` proxied to the backend).
