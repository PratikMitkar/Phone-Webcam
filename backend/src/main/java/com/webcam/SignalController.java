package com.webcam;

import java.net.InetAddress;
import java.net.NetworkInterface;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import jakarta.servlet.http.HttpServletRequest;

/**
 * WebRTC signaling relay between one "phone" and one "viewer". Video never passes
 * through here: it flows phone -> PC directly over WebRTC.
 *
 * Server-sent events + POST instead of WebSocket, because iOS Safari refuses
 * wss:// to a self-signed certificate even after the page itself was accepted.
 */
@RestController
@RequestMapping("/api")
class SignalController {

	private static final String PEER_JOINED = "{\"type\":\"peer-joined\"}";
	private static final String PEER_LEFT = "{\"type\":\"peer-left\"}";

	private final Map<String, SseEmitter> peers = new ConcurrentHashMap<>();
	private final String token;

	SignalController(@Value("${webcam.token:}") String token) {
		this.token = token;
	}

	/** Only the PC itself may ask for the phone link, since it contains the token. */
	@GetMapping("/info")
	Map<String, List<String>> info(HttpServletRequest request) throws Exception {
		if (!isLoopback(request)) {
			throw new ResponseStatusException(HttpStatus.FORBIDDEN);
		}
		// Looked up on every call, so a hotspot switched on later shows up without a restart.
		return Map.of("phoneUrls",
				BackendApplication.lanIps().stream().map(ip -> BackendApplication.phoneUrl(ip, token)).toList());
	}

	@GetMapping("/events")
	SseEmitter events(@RequestParam String role, @RequestParam(defaultValue = "") String token,
			HttpServletRequest request) throws Exception {
		authorize(request, token);
		String other = other(role);

		SseEmitter emitter = new SseEmitter(0L);
		SseEmitter previous = peers.put(role, emitter);
		if (previous != null) {
			previous.complete();
		}
		Runnable gone = () -> {
			if (peers.remove(role, emitter)) {
				send(other, PEER_LEFT);
			}
		};
		emitter.onCompletion(gone);
		emitter.onTimeout(gone);
		emitter.onError(error -> gone.run());

		if (peers.containsKey(other)) {
			send(role, PEER_JOINED);
			send(other, PEER_JOINED);
		}
		return emitter;
	}

	@PostMapping("/send")
	void relay(@RequestParam String role, @RequestParam(defaultValue = "") String token, @RequestBody String message,
			HttpServletRequest request) throws Exception {
		authorize(request, token);
		send(other(role), message);
	}

	/** Keeps connections alive and notices peers that vanished without closing. */
	@Scheduled(fixedRate = 10_000)
	void ping() {
		peers.forEach((role, emitter) -> {
			try {
				emitter.send(SseEmitter.event().comment("ping"));
			}
			catch (Exception ex) {
				emitter.completeWithError(ex);
			}
		});
	}

	void authorize(HttpServletRequest request, String given) throws Exception {
		boolean valid = !token.isEmpty() && MessageDigest.isEqual(token.getBytes(StandardCharsets.UTF_8),
				given.getBytes(StandardCharsets.UTF_8));
		if (!valid && !isLoopback(request)) {
			throw new ResponseStatusException(HttpStatus.FORBIDDEN);
		}
	}

	private static boolean isLoopback(HttpServletRequest request) throws Exception {
		// Also true when the PC opens itself by its LAN address instead of localhost.
		InetAddress address = InetAddress.getByName(request.getRemoteAddr());
		return address.isLoopbackAddress() || NetworkInterface.getByInetAddress(address) != null;
	}

	private static String other(String role) {
		return switch (role) {
			case "phone" -> "viewer";
			case "viewer" -> "phone";
			default -> throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
		};
	}

	private void send(String role, String message) {
		SseEmitter emitter = peers.get(role);
		if (emitter == null) {
			return;
		}
		try {
			emitter.send(message);
		}
		catch (Exception ex) {
			emitter.completeWithError(ex);
		}
	}

}
