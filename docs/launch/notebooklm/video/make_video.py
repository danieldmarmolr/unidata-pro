"""
Genera el video promocional UNIDATA renderizando cada frame del HTML
y combinando con ffmpeg con cross-fades.

Salida: unidata-promo.mp4 (1080x1920, ~30s, vertical)
"""
import os
import subprocess
import sys
from pathlib import Path

import imageio_ffmpeg

ROOT = Path(__file__).parent
HTML = ROOT / "frames.html"
PORT = 8766
NUM_FRAMES = 9
SCALE = 1  # 1 = 1080px wide, 2 = 2160px wide (HD)

CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()

# Tiempos por frame (segundos) — total ~31s
FRAME_DURATIONS = {
    0: 3.0,   # Antes
    1: 3.0,   # Home
    2: 3.5,   # Ventas
    3: 3.5,   # Logística
    4: 3.5,   # Finanzas
    5: 3.5,   # Marketing
    6: 4.0,   # SQL libre
    7: 3.5,   # Audit
    8: 4.0,   # CTA
}
FADE = 0.5  # cross-fade duration

def render_frames():
    """Renderiza cada frame del HTML a PNG con Chrome headless."""
    print(">> Renderizando frames...")
    for i in range(NUM_FRAMES):
        out = ROOT / f"frame_{i:02d}.png"
        url = f"http://localhost:{PORT}/frames.html?frame={i}"
        cmd = [
            CHROME,
            "--headless",
            "--disable-gpu",
            f"--window-size=1080,1920",
            f"--force-device-scale-factor={SCALE}",
            "--hide-scrollbars",
            "--virtual-time-budget=2000",
            f"--screenshot={out}",
            url,
        ]
        subprocess.run(cmd, capture_output=True, check=False)
        if not out.exists():
            print(f"  !! Frame {i} fallo")
            sys.exit(1)
        print(f"  ✓ frame_{i:02d}.png ({out.stat().st_size//1024} KB)")

def build_video():
    """Combina los frames en MP4 con cross-fades usando ffmpeg xfade."""
    print(">> Armando video con ffmpeg...")
    inputs = []
    for i in range(NUM_FRAMES):
        d = FRAME_DURATIONS[i]
        png = ROOT / f"frame_{i:02d}.png"
        inputs += ["-loop", "1", "-t", f"{d:.2f}", "-i", str(png)]

    # Build filter_complex with chained xfade transitions
    # Each xfade introduces a 'fade' duration of overlap.
    filters = []
    last = "[0:v]"
    cumulative = FRAME_DURATIONS[0]
    for i in range(1, NUM_FRAMES):
        offset = cumulative - FADE
        out_label = f"[v{i}]"
        # alternate transitions for variety
        trans = ["fade", "fadeblack", "smoothleft", "fade", "fadewhite", "fade", "smoothup", "fade"][i-1]
        filters.append(
            f"{last}[{i}:v]xfade=transition={trans}:duration={FADE}:offset={offset:.2f}{out_label}"
        )
        last = out_label
        cumulative += FRAME_DURATIONS[i] - FADE

    filter_complex = ";".join(filters)
    out_video = ROOT / "unidata-promo.mp4"

    cmd = [
        FFMPEG,
        "-y",
        *inputs,
        "-filter_complex", filter_complex,
        "-map", last,
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-r", "30",
        "-preset", "medium",
        "-crf", "20",
        str(out_video),
    ]
    print(f"   total duracion: {cumulative:.1f}s")
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print("FFMPEG ERROR:")
        print(result.stderr[-2000:])
        sys.exit(1)
    print(f"  ✓ {out_video.name} ({out_video.stat().st_size//1024} KB)")
    return out_video

if __name__ == "__main__":
    render_frames()
    video = build_video()
    print(f"\n✅ Listo: {video}")
