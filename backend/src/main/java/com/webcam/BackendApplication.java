package com.webcam;

import java.net.DatagramSocket;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HexFormat;
import java.util.List;

import org.apache.catalina.connector.Connector;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.tomcat.servlet.TomcatServletWebServerFactory;
import org.springframework.boot.web.server.WebServerFactoryCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class BackendApplication {

	static final int HTTP_PORT = 8088;
	static final int HTTPS_PORT = 8443;

	public static void main(String[] args) throws Exception {
		List<String> ips = lanIps();
		Path data = Files.createDirectories(Path.of("data"));

		// Phone browsers only allow camera access over HTTPS, so serve a self-signed
		// certificate. It names the PC's addresses: new addresses get a new certificate.
		Path keystore = data.resolve("keystore-" + String.join("_", ips) + ".p12");
		if (Files.notExists(keystore)) {
			generateCertificate(keystore, ips);
		}

		// The pairing token lives only as long as this server run.
		byte[] random = new byte[16];
		new SecureRandom().nextBytes(random);
		String token = HexFormat.of().formatHex(random);

		System.setProperty("server.ssl.key-store", keystore.toString());
		System.setProperty("webcam.token", token);
		SpringApplication.run(BackendApplication.class, args);

		System.out.println();
		System.out.println("  PC viewer : http://localhost:" + HTTP_PORT);
		ips.forEach(ip -> System.out.println("  Phone     : " + phoneUrl(ip, token)));
		System.out.println("  (or scan the QR code shown on the PC viewer)");
		System.out.println();
	}

	static String phoneUrl(String ip, String token) {
		return "https://" + ip + ":" + HTTPS_PORT + "/?role=phone&token=" + token;
	}

	/** Every address a phone could reach this PC on (Wi-Fi, Windows mobile hotspot, ...), main one first. */
	static List<String> lanIps() throws Exception {
		List<String> ips = new ArrayList<>();
		for (NetworkInterface adapter : Collections.list(NetworkInterface.getNetworkInterfaces())) {
			if (!adapter.isUp() || adapter.isLoopback()) {
				continue;
			}
			for (InetAddress address : Collections.list(adapter.getInetAddresses())) {
				if (address instanceof Inet4Address && address.isSiteLocalAddress()) {
					ips.add(address.getHostAddress());
				}
			}
		}
		// Connecting a UDP socket sends nothing; it only makes the OS pick the outgoing adapter.
		try (DatagramSocket socket = new DatagramSocket()) {
			socket.connect(InetAddress.getByName("8.8.8.8"), 53);
			String main = socket.getLocalAddress().getHostAddress();
			if (ips.remove(main)) {
				ips.add(0, main);
			}
		}
		catch (Exception offline) {
			// no default route: keep adapter order
		}
		return ips;
	}

	/** Plain HTTP next to HTTPS, so the PC (and OBS) can use localhost without a certificate warning. */
	@Bean
	WebServerFactoryCustomizer<TomcatServletWebServerFactory> httpConnector() {
		return factory -> {
			Connector connector = new Connector();
			connector.setPort(HTTP_PORT);
			factory.addAdditionalConnectors(connector);
		};
	}

	private static void generateCertificate(Path keystore, List<String> ips) throws Exception {
		String keytool = Path.of(System.getProperty("java.home"), "bin", "keytool").toString();
		StringBuilder san = new StringBuilder("san=dns:localhost,ip:127.0.0.1");
		ips.forEach(ip -> san.append(",ip:").append(ip));
		// SAN + serverAuth + validity under 398 days are required by iOS.
		int exit = new ProcessBuilder(keytool, "-genkeypair", "-alias", "webcam", "-keyalg", "RSA", "-keysize", "2048",
				"-validity", "365", "-storetype", "PKCS12", "-keystore", keystore.toString(), "-storepass", "changeit",
				"-dname", "CN=Phone Webcam", "-ext", san.toString(), "-ext", "eku=serverAuth").inheritIO()
			.start()
			.waitFor();
		if (exit != 0) {
			throw new IllegalStateException("keytool failed to create " + keystore);
		}
	}

}
