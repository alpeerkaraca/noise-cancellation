package com.noiseremover.Services;

import com.noiseremover.Models.FastApiResponseModel;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.http.*;
import org.springframework.stereotype.Service;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.multipart.MultipartFile;

@Service
public class AudioProcessingService {
    private static final Logger logger = LoggerFactory.getLogger(AudioProcessingService.class);
    @Value("${fastapi.service.url}")
    private String fastApiServiceUrl;

    private final RestTemplate restTemplate;
    private final ObjectMapper objectMapper;

    public AudioProcessingService(RestTemplate restTemplate, ObjectMapper objectMapper) {
        this.restTemplate = restTemplate;
        this.objectMapper = objectMapper;
    }

    public FastApiResponseModel processAudioFile(
            MultipartFile audioFile,
            String humFrequencies,
            double humBandwidth,
            double humAttenuation,
            double noiseProfileDuration,
            double noiseThresholdFactor,
            double generalNoiseAttenuation,
            int frameSize,
            int hopLengthDivisor) {
        String url = fastApiServiceUrl + "/remove_noise";
        logger.info("URL:" + url);
        logger.info("Processing audio file: {}", audioFile.getOriginalFilename());

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.MULTIPART_FORM_DATA);

        MultiValueMap<String, Object> body = new LinkedMultiValueMap<>();

        try {
            ByteArrayResource byteArrayResource = new ByteArrayResource(audioFile.getBytes()) {
                @Override
                public String getFilename() {
                    return audioFile.getOriginalFilename();
                }
            };
            body.add("file", byteArrayResource);
            body.add("hum_frequencies_str", humFrequencies);
            body.add("hum_bandwidth_hz", String.valueOf(humBandwidth));
            body.add("hum_attenuation_factor", String.valueOf(humAttenuation));
            body.add("noise_estimation_duration_sec", String.valueOf(noiseProfileDuration));
            body.add("spectral_gate_threshold_factor", String.valueOf(noiseThresholdFactor));
            body.add("noise_attenuation_factor", String.valueOf(generalNoiseAttenuation));
            body.add("frame_size", String.valueOf(frameSize));
            body.add("hop_length_divisor", String.valueOf(hopLengthDivisor));

            HttpEntity<MultiValueMap<String, Object>> requestEntity = new HttpEntity<>(body, headers);

            ResponseEntity<String> responseEntity = restTemplate.postForEntity(url, requestEntity, String.class);

            if (responseEntity.getStatusCode().is2xxSuccessful() && responseEntity.getBody() != null) {
                logger.info("FastAPI'den başarılı yanıt alındı.");
                var response = objectMapper.readValue(responseEntity.getBody(), FastApiResponseModel.class);
                return response;
            } else {
                logger.error("FastAPI'den beklenmeyen yanıt durumu: {} - {}", responseEntity.getStatusCode(),
                        responseEntity.getBody());
                return new FastApiResponseModel("error",
                        "FastAPI'den beklenmeyen yanıt: " + responseEntity.getStatusCode());
            }

        } catch (Exception e) {
            logger.error("Hata oluştu: {}", e.getMessage());
            return new FastApiResponseModel("error", "Hata oluştu: " + e.getMessage());
        }

    }
}
