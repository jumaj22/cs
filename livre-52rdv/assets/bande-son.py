"""Bande-son 30 s : silence domestique (0-17 s) puis cordes + piano (17-30 s)."""
import sys
import numpy as np
from scipy.signal import fftconvolve, butter, sosfilt
from scipy.io import wavfile

SR = 44100
DUR = 30.0
N = int(SR * DUR)
rng = np.random.default_rng(52)
L = np.zeros(N)
R = np.zeros(N)


def t_idx(t):
    return int(t * SR)


def add(sig, t0, gain=1.0, pan=0.0):
    if t0 < 16.9:
        gain *= 3.5
    i = t_idx(t0)
    j = min(N, i + len(sig))
    sig = sig[: j - i] * gain
    L[i:j] += sig * np.sqrt(0.5 * (1 - pan))
    R[i:j] += sig * np.sqrt(0.5 * (1 + pan))


def lp(x, f, order=2):
    return sosfilt(butter(order, f, "low", fs=SR, output="sos"), x)


def hp(x, f, order=2):
    return sosfilt(butter(order, f, "high", fs=SR, output="sos"), x)


def bp(x, lo, hi):
    return sosfilt(butter(2, [lo, hi], "band", fs=SR, output="sos"), x)


def env(n, a, r):
    e = np.ones(n)
    na, nr = int(a * SR), int(r * SR)
    e[:na] = np.linspace(0, 1, na)
    e[n - nr:] *= np.linspace(1, 0, nr)
    return e


# ---------- 0-5 s : ronronnement du frigo ----------
n = t_idx(5.4)
tt = np.arange(n) / SR
hum = sum(a * np.sin(2 * np.pi * f * tt) for f, a in [(50, 1), (100, .6), (150, .25), (200, .12)])
hum = hum * (1 + .15 * np.sin(2 * np.pi * .7 * tt)) + lp(rng.standard_normal(n), 300) * .5
add(hum * env(n, .6, .8), 0, .018)

# ---------- 5-9 s : clés + porte ----------
def jingle(t0):
    for k in range(9):
        m = int(.09 * SR)
        x = np.arange(m) / SR
        f = rng.uniform(3500, 7500)
        s = np.sin(2 * np.pi * f * x) * np.exp(-x * 60) + .3 * hp(rng.standard_normal(m), 4000) * np.exp(-x * 120)
        add(s, t0 + k * .035 + rng.uniform(0, .03), .05, pan=-.2)

jingle(5.55)
# pas flottants : quasi rien. Poignée + porte qui se ferme doucement
def thud(t0, g):
    m = int(.6 * SR)
    x = np.arange(m) / SR
    s = np.sin(2 * np.pi * 70 * x) * np.exp(-x * 14) + .5 * lp(rng.standard_normal(m), 900) * np.exp(-x * 25)
    add(s, t0, g, pan=.3)

def click(t0, g):
    m = int(.05 * SR)
    x = np.arange(m) / SR
    add(bp(rng.standard_normal(m), 1500, 5000) * np.exp(-x * 150), t0, g, pan=.3)

click(7.05, .05)
thud(8.45, .16)
click(8.5, .06)
# souffle de pièce vide 5-9
n = t_idx(4.2)
add(lp(rng.standard_normal(n), 250) * env(n, .5, .5), 5.0, .012)

# ---------- 9-13 s : horloge + téléphones ----------
for k in range(5):
    m = int(.03 * SR)
    x = np.arange(m) / SR
    tick = bp(rng.standard_normal(m), 2500, 7000) * np.exp(-x * 220)
    add(tick, 9.0 + k, .035 if k % 2 == 0 else .025, pan=.5)
for t0, f in [(9.6, 1760), (10.9, 1320), (11.7, 1980), (12.4, 1568)]:
    m = int(.04 * SR)
    x = np.arange(m) / SR
    add(np.sin(2 * np.pi * f * x) * np.exp(-x * 90), t0, .02, pan=rng.uniform(-.4, .4))
m = int(.35 * SR)
x = np.arange(m) / SR
add(np.sin(2 * np.pi * 160 * x) * (np.sin(2 * np.pi * 22 * x) > 0) * env(m, .02, .05), 11.2, .02, pan=-.3)

# ---------- 13-17 s : presque silence ----------
n = t_idx(4.2)
add(lp(rng.standard_normal(n), 180) * env(n, .5, .6), 12.9, .008)
for k in range(4):
    m = int(.03 * SR)
    xx = np.arange(m) / SR
    add(bp(rng.standard_normal(m), 2500, 7000) * np.exp(-xx * 220), 13.3 + k, .008, pan=.6)

# ---------- 17-30 s : musique ----------
def mtof(m):
    return 440 * 2 ** ((m - 69) / 12)


def strings(notes, t0, t1, gain, a=1.2, r=1.5, bright=2500):
    n = t_idx(t1 - t0 + r)
    x = np.arange(n) / SR
    out = np.zeros(n)
    for mi, midi in enumerate(notes):
        f0 = mtof(midi)
        for d in (-6, 0, 7):  # désaccord = ensemble
            f = f0 * 2 ** (d / 1200)
            vib = 1 + .004 * np.sin(2 * np.pi * (5 + .3 * d / 7) * x + mi)
            ph = 2 * np.pi * np.cumsum(f * vib) / SR + rng.uniform(0, 6.28)
            saw = sum(np.sin(k * ph) / k for k in range(1, 14) if f * k < 9000)
            out += saw
    out = lp(out, bright, 2)
    e = np.ones(n)
    na = int(a * SR)
    e[:na] = (np.linspace(0, 1, na)) ** 1.6
    nr = int(r * SR)
    e[n - nr:] *= np.linspace(1, 0, nr) ** 1.5
    add(out * e / len(notes), t0, gain)


def piano(midi, t0, gain, length=3.5, pan=0.0):
    n = t_idx(length)
    x = np.arange(n) / SR
    f = mtof(midi)
    s = np.zeros(n)
    for k, a in enumerate([1, .45, .25, .12, .07, .04], start=1):
        s += a * np.sin(2 * np.pi * f * k * 1.0008 ** (k - 1) * x) * np.exp(-x * (1.6 + k * .9))
    s += .05 * hp(rng.standard_normal(n), 2000) * np.exp(-x * 80)
    s *= 1 - np.exp(-x * 400)
    add(s, t0, gain, pan)


# Ré majeur : D - Bm - G - A ... -> crescendo -> G - A - D
D, Bm, G, A, Em = [50, 57, 62, 66], [47, 54, 59, 62], [43, 55, 59, 62], [45, 57, 61, 64], [40, 55, 59, 64]
prog = [
    (17.0, 19.6, D, .10, 2400),
    (19.0, 21.6, Bm, .13, 2600),
    (21.0, 23.3, G, .17, 3000),
    (22.8, 24.6, A, .22, 3400),
    (24.2, 25.9, Bm, .27, 3800),
    (25.5, 27.1, G, .32, 4300),
    (26.7, 28.0, A, .34, 4500),
    (27.6, 30.0, D, .26, 3200),
]
for t0, t1, ch, g, br in prog:
    strings(ch, t0, t1, g, a=1.0, r=1.4, bright=br)
    strings([m + 12 for m in ch[1:]], t0 + .2, t1, g * .45, a=1.2, r=1.4, bright=br)
# basse grave à partir du crescendo
for t0, t1, b in [(22.8, 24.6, 33), (24.2, 25.9, 35), (25.5, 27.1, 31), (26.7, 28.0, 33), (27.6, 30.0, 38)]:
    strings([b], t0, t1, .16, a=.8, r=1.4, bright=900)

# mélodie de piano
mel = [
    (17.4, 78), (18.2, 76), (18.9, 74), (19.05, 81),  # toucher du livre ~19 s
    (19.9, 78), (20.6, 74), (21.3, 79), (22.0, 78), (22.6, 76),
    (23.2, 76), (23.7, 78), (24.2, 81), (24.9, 78), (25.5, 83),
    (26.1, 81), (26.7, 79), (27.3, 78), (27.7, 76), (28.2, 74),
]
for t0, m in mel:
    piano(m, t0, .16, pan=.15)
    piano(m - 12, t0, .05, pan=-.1)
# arpège léger en accompagnement
for i, t0 in enumerate(np.arange(19.0, 27.6, .43)):
    chord = D if t0 < 21 else (G if t0 < 22.8 else (A if t0 < 24.2 else (Bm if t0 < 25.5 else (G if t0 < 26.7 else A))))
    piano(chord[i % 3 + 1] + 12, t0, .045, length=2.0, pan=-.35 + .7 * (i % 2))
# accord final de piano
for m in [62, 66, 69, 74]:
    piano(m, 27.75, .09, length=3.0)
# scintillement au contact du livre
for k in range(7):
    piano(86 + [0, 4, 7, 12, 7, 4, 0][k], 19.0 + k * .07, .03, length=1.5, pan=-.5 + k * .15)

# ---------- réverbération ----------
ir_len = int(2.6 * SR)
xi = np.arange(ir_len) / SR
irL = rng.standard_normal(ir_len) * np.exp(-xi * 2.4)
irR = rng.standard_normal(ir_len) * np.exp(-xi * 2.4)
irL, irR = lp(irL, 6000), lp(irR, 6000)
irL /= np.sqrt((irL ** 2).sum())
irR /= np.sqrt((irR ** 2).sum())
wet = .35
Lw = fftconvolve(L, irL)[:N]
Rw = fftconvolve(R, irR)[:N]
L2, R2 = L + wet * Lw, R + wet * Rw

# fondu final
fade = np.ones(N)
fs = t_idx(28.6)
fade[fs:] = np.linspace(1, 0, N - fs) ** 1.4
L2 *= fade
R2 *= fade
peak = max(np.abs(L2).max(), np.abs(R2).max())
st = np.stack([L2, R2], 1) / peak * .89
wavfile.write(sys.argv[1], SR, (st * 32767).astype(np.int16))
print("ok", peak)
