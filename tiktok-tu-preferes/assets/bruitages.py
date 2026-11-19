"""Bruitages seuls (pas de musique) pour la vidéo « Tu préfères… ? version couple ».
Usage : python3 bruitages.py sortie.wav
"""
import sys
import numpy as np
from scipy.signal import butter, sosfilt
from scipy.io import wavfile

SR = 44100
DUR = 35.0
N = int(SR * DUR)
rng = np.random.default_rng(7)
L = np.zeros(N)
R = np.zeros(N)


def add(sig, t0, gain=1.0, pan=0.0):
    i = int(t0 * SR)
    j = min(N, i + len(sig))
    s = sig[: j - i] * gain
    L[i:j] += s * np.sqrt(0.5 * (1 - pan))
    R[i:j] += s * np.sqrt(0.5 * (1 + pan))


def bp(x, lo, hi):
    return sosfilt(butter(2, [lo, hi], "band", fs=SR, output="sos"), x)


def whoosh(t0, length=0.45, gain=0.5, up=True):
    n = int(length * SR)
    x = np.arange(n) / SR
    noise = rng.standard_normal(n)
    out = np.zeros(n)
    seg = 32
    for k in range(seg):
        a, b = k * n // seg, (k + 1) * n // seg
        p = k / seg if up else 1 - k / seg
        f = 300 + 3500 * p
        out[a:b] = bp(noise, f * 0.7, min(f * 1.4, 20000))[a:b]
    e = np.sin(np.pi * x / length) ** 2
    add(out * e, t0, gain)


def tick(t0, gain=0.35):
    n = int(0.04 * SR)
    x = np.arange(n) / SR
    s = bp(rng.standard_normal(n), 2500, 8000) * np.exp(-x * 180) + 0.6 * np.sin(2 * np.pi * 1800 * x) * np.exp(-x * 120)
    add(s, t0, gain, pan=0.1)


def ding(t0, gain=0.35, base=1318.5):
    n = int(1.2 * SR)
    x = np.arange(n) / SR
    s = sum(a * np.sin(2 * np.pi * base * m * x) * np.exp(-x * d) for m, a, d in [(1, 1, 3.5), (2.76, .35, 6), (5.4, .15, 9)])
    add(s * (1 - np.exp(-x * 500)), t0, gain)


def pop(t0, gain=0.45, f0=900, f1=320):
    n = int(0.12 * SR)
    x = np.arange(n) / SR
    f = f1 + (f0 - f1) * np.exp(-x * 40)
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-x * 30)
    add(s, t0, gain)


def shimmer(t0, gain=0.18):
    notes = [2093, 2637, 3136, 4186, 3136, 3951, 5274]
    for k, f in enumerate(notes):
        n = int(0.9 * SR)
        x = np.arange(n) / SR
        s = np.sin(2 * np.pi * f * x) * np.exp(-x * 5) * (1 - np.exp(-x * 300))
        add(s, t0 + k * 0.06, gain, pan=-0.6 + k * 0.2)


def page(t0, gain=0.25):
    n = int(0.35 * SR)
    x = np.arange(n) / SR
    s = bp(rng.standard_normal(n), 1500, 7000) * np.exp(-((x - 0.12) ** 2) / 0.004)
    add(s, t0, gain)


# accroche
whoosh(0.05, 0.5, 0.45)
pop(0.55, 0.5)
for k, t in enumerate([0.9, 1.15, 1.4]):
    pop(t, 0.25, f0=1100 + k * 150, f1=500 + k * 80)

# 6 questions
T0, STEP = 2.5, 4.0
for i in range(6):
    t = T0 + i * STEP
    whoosh(t - 0.05, 0.4, 0.4)
    pop(t + 0.25, 0.3, f0=700, f1=300)
    pop(t + 0.42, 0.3, f0=760, f1=320)
    for k in range(3):
        tick(t + 0.9 + k, 0.35)
    ding(t + 3.4, 0.3, base=1318.5 if i % 2 == 0 else 1396.9)

# appel aux commentaires
whoosh(26.45, 0.4, 0.4)
pop(26.75, 0.45)
pop(27.3, 0.3, f0=1200, f1=600)

# promo livre
whoosh(28.45, 0.55, 0.45, up=False)
page(29.6, 0.3)
shimmer(30.3, 0.16)
ding(30.35, 0.22, base=1046.5)
pop(32.0, 0.25, f0=1000, f1=450)
pop(33.0, 0.25, f0=1100, f1=500)

peak = max(np.abs(L).max(), np.abs(R).max())
st = np.stack([L, R], 1) / peak * 0.89
wavfile.write(sys.argv[1], SR, (st * 32767).astype(np.int16))
print("ok")
