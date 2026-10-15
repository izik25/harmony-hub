"""
Raw phone take in, dry studio vocal out — the ML step the browser DSP chain can't do.

Two passes, both RoFormer models run through python-audio-separator:
  1. Vocal isolation (BS-RoFormer): keeps only the voice. On a speaker take this removes the
     backing track that leaked into the mic, plus most background noise.
  2. De-reverb (MelBand-RoFormer, anvuew): strips the room the take was sung in — the reflections
     no EQ/gate can separate from the voice because they share its frequencies and timing.

Timing is preserved sample-for-sample, so the app can drop the result in place of the raw take
(bleed alignment still measures off the raw take, which is where the bleed actually is).
"""

import re
import shutil
import subprocess
import tempfile
from pathlib import Path as FsPath

from audio_separator.separator import Separator
from cog import BasePredictor, Input, Path

MODEL_DIR = "/models"
VOCALS_MODEL = "model_bs_roformer_ep_317_sdr_12.9755.ckpt"
DEREVERB_MODELS = {
    "normal": "dereverb_mel_band_roformer_anvuew_sdr_19.1729.ckpt",
    "gentle": "dereverb_mel_band_roformer_less_aggressive_anvuew_sdr_18.8050.ckpt",
}


def _ffmpeg(*args: str) -> None:
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *args], check=True)


def _pick(files: list[str], out_dir: FsPath, pattern: str) -> FsPath:
    """separate() returns stem filenames (sometimes relative to output_dir); pick the one whose
    stem label matches, rather than relying on output order."""
    for name in files:
        if re.search(pattern, FsPath(name).name, re.IGNORECASE):
            path = FsPath(name)
            return path if path.is_absolute() else out_dir / path
    raise RuntimeError(f"no output matching {pattern!r} in {files}")


class Predictor(BasePredictor):
    def setup(self) -> None:
        self.work = FsPath(tempfile.mkdtemp())
        self.separators: dict[str, Separator] = {}
        self._separator(VOCALS_MODEL)
        self._separator(DEREVERB_MODELS["normal"])

    def _separator(self, model: str) -> Separator:
        # One loaded instance per model — switching weights on a single Separator per request
        # would reload a checkpoint from disk every time.
        if model not in self.separators:
            out_dir = self.work / model
            out_dir.mkdir(parents=True, exist_ok=True)
            separator = Separator(model_file_dir=MODEL_DIR, output_dir=str(out_dir))
            separator.load_model(model_filename=model)
            self.separators[model] = separator
        return self.separators[model]

    def _run(self, model: str, audio: FsPath, pattern: str, dest: FsPath) -> FsPath:
        separator = self._separator(model)
        out_dir = FsPath(separator.output_dir)
        for old in out_dir.iterdir():
            old.unlink()
        picked = _pick(separator.separate(str(audio)), out_dir, pattern)
        shutil.move(str(picked), dest)
        return dest

    def predict(
        self,
        audio: Path = Input(description="Raw vocal take (any format ffmpeg reads, incl. webm/mp4)"),
        reverb_removal: str = Input(
            description="How hard to strip the room: normal, gentle (keeps a little air), or off",
            choices=["normal", "gentle", "off"],
            default="normal",
        ),
        isolate_vocals: bool = Input(
            description="Remove backing-track bleed and background noise first",
            default=True,
        ),
    ) -> Path:
        job = FsPath(tempfile.mkdtemp())
        # Phone captures arrive as mono webm/mp4; the models expect 44.1kHz stereo audio.
        current = job / "input.wav"
        _ffmpeg("-i", str(audio), "-vn", "-ac", "2", "-ar", "44100", str(current))

        if isolate_vocals:
            current = self._run(VOCALS_MODEL, current, r"\(vocals\)", job / "vocals.wav")

        if reverb_removal != "off":
            current = self._run(
                DEREVERB_MODELS[reverb_removal],
                current,
                r"\(no[ _-]?reverb\)|\(dry\)",
                job / "dry.wav",
            )

        # Back to mono (the app's chain is mono) and FLAC: half the size of WAV, lossless, and
        # decodeAudioData reads it in every current browser.
        out = job / "clean-vocal.flac"
        _ffmpeg("-i", str(current), "-ac", "1", "-c:a", "flac", str(out))
        return Path(out)
