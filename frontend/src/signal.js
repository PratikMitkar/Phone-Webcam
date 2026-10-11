const token = new URLSearchParams(location.search).get('token') ?? ''

// Signaling channel to the other side (phone <-> viewer), relayed by the backend.
export function connect(role, onMessage) {
  const query = `role=${role}&token=${encodeURIComponent(token)}`
  const source = new EventSource(`/api/events?${query}`)

  // Messages are handled and sent strictly one at a time: an ICE candidate must
  // never overtake the offer/answer it belongs to.
  let incoming = Promise.resolve()
  source.onmessage = (event) => {
    incoming = incoming.then(() => onMessage(JSON.parse(event.data))).catch(console.error)
  }

  let outgoing = Promise.resolve()
  const send = (message) => {
    outgoing = outgoing
      .then(() => fetch(`/api/send?${query}`, { method: 'POST', body: JSON.stringify(message) }))
      .catch(console.error)
  }

  return { send, close: () => source.close() }
}
