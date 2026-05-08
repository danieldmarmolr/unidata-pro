"""
Genera el video promocional UNIDATA estilo Apple.
14 frames · fundidos lentos a negro · vertical 1080x1920.
"""
import subprocess, sys
from pathlib import Path
import imageio_ffmpeg

ROOT = Path(__file__).parent
PORT = 8766
NUM_FRAMES = 14
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()

# Apple style: holds más largos en hero text, showcase más rápidos pero respirados
DUR = {
    0: 1.8,   # Datos.
    1: 2.0,   # En todos lados.
    2: 2.2,   # Hasta ahora.
    3: 3.0,   # Logo reveal
    4: 2.4,   # 14+ stat
    5: 2.5,   # Home
    6: 2.5,   # Ventas
    7: 2.5,   # Finanzas
    8: 2.5,   # Marketing
    9: 2.5,   # Logística
    10: 2.8,  # SQL
    11: 2.4,  # Una sola web.
    12: 2.4,  # Mobile. Audit. SQL safe.
    13: 4.0,  # CTA final
}
FADE = 0.6   # cross-fade más largo, sensación cinematográfica

def render_frames():
    print(">> Renderizando frames Apple-style...")
    for i in range(NUM_FRAMES):
        out = ROOT / f"af_{i:02d}.png"
        url = f"http://localhost:{PORT}/frames-apple.html?frame={i}"
        cmd = [CHROME, "--headless", "--disable-gpu",
               "--window-size=1080,1920", "--force-device-scale-factor=1",
               "--hide-scrollbars", "--virtual-time-budget=2500",
               f"--screenshot={out}", url]
        subprocess.run(cmd, capture_output=True, check=False)
        if not out.exists():
            print(f"  !! Frame {i} fallo"); sys.exit(1)
        print(f"  [OK] af_{i:02d}.png ({out.stat().st_size//1024} KB)")

def build_video():
    print(">> Armando video con ffmpeg (cross-fades cinematicos)...")
    inputs = []
    for i in range(NUM_FRAMES):
        d = DUR[i]
        inputs += ["-loop", "1", "-t", f"{d:.2f}", "-i", str(ROOT / f"af_{i:02d}.png")]

    filters = []
    last = "[0:v]"
    cumulative = DUR[0]
    # Apple usa fundidos suaves; usamos solo "fade" puro
    for i in range(1, NUM_FRAMES):
        offset = cumulative - FADE
        out_label = f"[v{i}]"
        filters.append(f"{last}[{i}:v]xfade=transition=fade:duration={FADE}:offset={offset:.2f}{out_label}")
        last = out_label
        cumulative += DUR[i] - FADE

    out_video = ROOT / "unidata-promo-apple.mp4"
    cmd = [FFMPEG, "-y", *inputs,
           "-filter_complex", ";".join(filters),
           "-map", last,
           "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", "30",
           "-preset", "medium", "-crf", "19",
           str(out_video)]
    print(f"   total duracion: {cumulative:.1f}s")
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        print(r.stderr[-2000:]); sys.exit(1)
    print(f"  [OK] {out_video.name} ({out_video.stat().st_size//1024} KB)")
    return out_video

if __name__ == "__main__":
    render_frames()
    v = build_video()
    print(f"\nListo: {v}")
