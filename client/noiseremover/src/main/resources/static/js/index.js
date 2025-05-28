document.addEventListener("DOMContentLoaded", function () {
        const toggleButton = document.getElementById("toggleAdvancedButton");
        const advancedParametersDiv =
          document.getElementById("advancedParameters");

        let showAdvancedInitially = false;
        const advancedInputs = advancedParametersDiv.querySelectorAll(
          'input[type="text"], input[type="number"]'
        );
        const defaultValues = {
          // Thymeleaf'te kullandığınız varsayılanlar
          humFrequencies: "60,120,180",
          humBandwidth: "10.0",
          humAttenuation: "0.05",
          noiseProfileDuration: "0.5",
          noiseThresholdFactor: "1.5",
          generalNoiseAttenuation: "0.1",
          frameSize: "2048",
          hopLengthDivisor: "4",
        };

        advancedInputs.forEach((input) => {
          if (
            input.value &&
            defaultValues.hasOwnProperty(input.name) &&
            input.value !== defaultValues[input.name]
          ) {
            showAdvancedInitially = false;
          }
        });

        const errorMessageDiv = document.querySelector(".error-message");
        if (errorMessageDiv && errorMessageDiv.textContent.trim() !== "") {
          showAdvancedInitially = false;
        }

        if (showAdvancedInitially) {
          advancedParametersDiv.style.display = "block";
          toggleButton.textContent = "Gelişmiş Ayarları Gizle";
        }

        toggleButton.addEventListener("click", function () {
          const isHidden = advancedParametersDiv.style.display === "none";
          if (isHidden) {
            advancedParametersDiv.style.display = "block";
            this.textContent = "Gelişmiş Ayarları Gizle";
          } else {
            advancedParametersDiv.style.display = "none";
            this.textContent = "Gelişmiş Ayarları Göster";
          }
        });
      });