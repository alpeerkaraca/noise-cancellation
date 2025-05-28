package com.noiseremover.Controllers;

import com.noiseremover.Models.FastApiResponseModel;
import com.noiseremover.Services.AudioProcessingService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.servlet.mvc.support.RedirectAttributes;

@Controller
public class AudioProcessingController {
    private static final Logger logger = LoggerFactory.getLogger(AudioProcessingController.class);
    private final AudioProcessingService audioProcessingService;

    public AudioProcessingController(AudioProcessingService audioProcessingService) {
        this.audioProcessingService = audioProcessingService;
    }

    @GetMapping("/")
    public String index(Model model) {

        if (!model.containsAttribute("humFrequencies")) {
            model.addAttribute("humFrequencies", "60,120,180,240,300");
            model.addAttribute("humBandwidth", 6.0);
            model.addAttribute("humAttenuation", 0.0);
            model.addAttribute("noiseProfileDuration", 0.5);
            model.addAttribute("noiseThresholdFactor", 2.0);
            model.addAttribute("generalNoiseAttenuation", 0.1);
            model.addAttribute("frameSize", 2048);
            model.addAttribute("hopLengthDivisor", 4);
        }

        return "index";
    }

    @PostMapping("/remove_noise")
    public String removeNoise(
            @RequestParam("audioFile") MultipartFile file,
            @RequestParam("humFrequencies") String humFrequencies,
            @RequestParam("humBandwidth") double humBandwidth,
            @RequestParam("humAttenuation") double humAttenuation,
            @RequestParam("noiseProfileDuration") double noiseProfileDuration,
            @RequestParam("noiseThresholdFactor") double noiseThresholdFactor,
            @RequestParam("generalNoiseAttenuation") double generalNoiseAttenuation,
            @RequestParam("frameSize") int frameSize,
            @RequestParam("hopLengthDivisor") int hopLengthDivisor,
            Model model,
            RedirectAttributes redirectAttributes) {

        logger.info("İstek Alındı: {}", file.getOriginalFilename());

        if (file.isEmpty()) {
            redirectAttributes.addFlashAttribute("error", "Lütfen bir dosya yükleyin.");
            return "redirect:/";
        }

        String contentType = file.getContentType();
        if (contentType == null || (!contentType.equals("audio/wav") && !contentType.equals("audio/x-wav"))) {
            if (file.getOriginalFilename() != null
                    && !file.getOriginalFilename().toLowerCase().endsWith(".wav")) {
                redirectAttributes.addFlashAttribute("errorMessage", "Lütfen geçerli bir WAV dosyası yükleyin.");
                redirectAttributes.addFlashAttribute("humFrequencies", humFrequencies);
                return "redirect:/";
            }
            logger.warn("{} Dosyasının Uzantısı:  {}, Sadece .wav dosyalarına izin veriliyor.",
                    file.getOriginalFilename(), contentType);
        }

        FastApiResponseModel res = audioProcessingService.processAudioFile(file, humFrequencies, humBandwidth,
                humAttenuation, noiseProfileDuration, noiseThresholdFactor, generalNoiseAttenuation, frameSize,
                hopLengthDivisor);

        if ("success".equals(res.getStatus())) {
            redirectAttributes.addFlashAttribute("successMessage", "Gürültü başarıyla kaldırıldı.");
            model.addAttribute("result", res);
            return "result";
        } else {
            logger.warn("Ses işlenirken hata oluştu: {}", res.getMessage());
            model.addAttribute("errorMessage", "İşlem sırasında hata: " + res.getMessage());
            
            model.addAttribute("humFrequencies", humFrequencies);
            model.addAttribute("humBandwidth", humBandwidth);
            model.addAttribute("humAttenuation", humAttenuation);
            model.addAttribute("noiseProfileDuration", noiseProfileDuration);
            model.addAttribute("noiseThresholdFactor", noiseThresholdFactor);
            model.addAttribute("generalNoiseAttenuation", generalNoiseAttenuation);
            model.addAttribute("frameSize", frameSize);
            model.addAttribute("hopLengthDivisor", hopLengthDivisor);
            return "index";
        }
    }

    @GetMapping("/realtime")
    public String realtimeAncPage(Model model) {
        logger.info("/realtime endpoint accessed");
        return "realtime";
    }
    

}
