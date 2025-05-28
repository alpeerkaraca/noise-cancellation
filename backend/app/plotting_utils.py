import numpy as np
import matplotlib

import matplotlib.pyplot as plt
import os
import logging

logger = logging.getLogger(__name__)

matplotlib.use("Agg")


def plot_signal_to_file(
    signal, sample_rate, output_directory, filename_prefix, title="Audio Signal"
):
    plt.figure(figsize=(12, 4))
    time_axis = np.arange(len(signal)) / sample_rate
    plt.plot(time_axis, signal)
    plt.title(title)
    plt.xlabel("Zaman (s)")
    plt.ylabel("Genlik")
    plt.grid(True)

    plot_filename = f"{filename_prefix}_signal.png"
    full_path = os.path.join(output_directory, plot_filename)

    try:
        plt.savefig(full_path)
    except Exception as e:
        logger.error(f"Error saving plot {full_path}: {e}", exc_info=True)
        plt.close()
        raise
    else:
        plt.close()

    return plot_filename


def plot_magnitude_spectrum_frame_to_file(
    fft_frame_result,
    N_fft,
    sample_rate,
    output_directory,
    filename_prefix,
    title="Çerçeve Frekans Spektrumu",
):

    magnitude_spectrum = np.abs(fft_frame_result)
    frequencies = np.fft.rfftfreq(N_fft, d=1.0 / sample_rate)

    plot_filename_linear = f"{filename_prefix}_spectrum_linear.png"
    full_path_linear = os.path.join(output_directory, plot_filename_linear)
    plot_filename_db = f"{filename_prefix}_spectrum_db.png"
    full_path_db = os.path.join(output_directory, plot_filename_db)

    fig_linear = plt.figure(figsize=(12, 6))
    plt.plot(frequencies, magnitude_spectrum)
    plt.title(title)
    plt.xlabel("Frekans (Hz)")
    plt.ylabel("Büyüklük")
    plt.grid(True)
    try:
        plt.savefig(full_path_linear)
    except Exception as e:
        logger.error(f"Error saving plot {full_path_linear}: {e}", exc_info=True)
        plt.close(fig_linear)
        raise
    else:
        plt.close(fig_linear)

    fig_db = plt.figure(figsize=(12, 6))
    magnitude_db = 20 * np.log10(magnitude_spectrum + 1e-9)
    plt.plot(frequencies, magnitude_db)
    plt.title(title + " (dB)")
    plt.xlabel("Frekans (Hz)")
    plt.ylabel("Büyüklük (dB)")
    plt.grid(True)
    try:
        plt.savefig(full_path_db)
    except Exception as e:
        logger.error(f"Error saving plot {full_path_db}: {e}", exc_info=True)
        plt.close(fig_db)
        raise
    else:
        plt.close(fig_db)

    return plot_filename_linear, plot_filename_db
