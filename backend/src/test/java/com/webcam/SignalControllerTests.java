package com.webcam;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.server.ResponseStatusException;

class SignalControllerTests {

	private final SignalController controller = new SignalController("secret");

	@Test
	void lanClientsNeedTheToken() {
		MockHttpServletRequest phone = new MockHttpServletRequest();
		phone.setRemoteAddr("192.168.1.20");

		assertDoesNotThrow(() -> controller.authorize(phone, "secret"));
		assertThrows(ResponseStatusException.class, () -> controller.authorize(phone, "wrong"));
		assertThrows(ResponseStatusException.class, () -> controller.authorize(phone, ""));
		assertThrows(ResponseStatusException.class, () -> controller.info(phone));
	}

	@Test
	void thePcItselfDoesNot() {
		MockHttpServletRequest pc = new MockHttpServletRequest();
		pc.setRemoteAddr("127.0.0.1");

		assertDoesNotThrow(() -> controller.authorize(pc, ""));
		assertDoesNotThrow(() -> controller.info(pc));
	}

}
