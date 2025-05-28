package com.noiseremover.Models;

import java.util.Map;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

@JsonIgnoreProperties(ignoreUnknown = true)
public class FastApiResponseModel {
    private String status;
    private String message;

    @JsonProperty("input_file")
    private String inputFile;

    @JsonProperty("output_file")
    private String outputFile;

    @JsonProperty("plot_urls")
    private Map<String, String> plotUrls;

    @JsonProperty("session_id")
    private String sessionId;

    @JsonProperty("processed_audio_url")
    private String processedAudioUrl;

    public void setProcessedAudioUrl(String processedAudioUrl) {
        this.processedAudioUrl = processedAudioUrl;
    }

    public String getProcessedAudioUrl() {
        return processedAudioUrl;
    }

    public String getStatus() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status;
    }

    public String getMessage() {
        return message;
    }

    public void setMessage(String message) {
        this.message = message;
    }

    public String getInputFile() {
        return inputFile;
    }

    public void setInputFile(String inputFile) {
        this.inputFile = inputFile;
    }

    public String getOutputFile() {
        return outputFile;
    }

    public void setOutputFile(String outputFile) {
        this.outputFile = outputFile;
    }

    public Map<String, String> getPlotUrls() {
        return plotUrls;
    }

    public void setPlotUrls(Map<String, String> plotUrls) {
        this.plotUrls = plotUrls;
    }

    public String getSessionId() {
        return sessionId;
    }

    public void setSessionId(String sessionId) {
        this.sessionId = sessionId;
    }

    public FastApiResponseModel() {
    }

    public FastApiResponseModel(String status, String message) {
        this.status = status;
        this.message = message;
    }

    @Override
    public String toString() {
        return "FastApiResponseModel [status=" + status + ", message=" + message + ", inputFile=" + inputFile
                + ", outputFile=" + outputFile + ", plotUrls=" + plotUrls + ", sessionId=" + sessionId
                + ", processedAudioUrl=" + processedAudioUrl + "]";
    }

}
