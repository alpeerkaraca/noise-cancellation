package com.noiseremover.noiseremover;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication(scanBasePackages = "com.noiseremover")
public class NoiseremoverApplication {

	public static void main(String[] args) {
		SpringApplication.run(NoiseremoverApplication.class, args);
	}

}
