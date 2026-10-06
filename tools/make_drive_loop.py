# Seamless driving loop for the game from the recording in "Skaņas no Jāņa"
# (garuda1982, Freesound 541240 "tank bulldozer tracked vehicle sound effect atmo", CC BY 4.0).
# Run: python tools/make_drive_loop.py  ->  web/assets/tank_drive.wav (32 kHz mono, ~14 s loop)
import numpy as np, wave, glob, os

HERE = os.path.dirname(os.path.abspath(__file__))
f = glob.glob(os.path.join(HERE, '..', 'Skaņas no Jāņa', '541240*.wav'))[0]
w = wave.open(f); raw = w.readframes(w.getnframes()); ch = w.getnchannels()
b = np.frombuffer(raw, np.uint8).reshape(-1, 3)          # 24-bit little endian
x = (b[:, 0].astype(np.int32) | (b[:, 1].astype(np.int32) << 8) | (b[:, 2].astype(np.int32) << 16))
x = np.where(x >= 1 << 23, x - (1 << 24), x).astype(np.float32) / (1 << 23)
x = x.reshape(-1, ch).mean(1)
SR0 = w.getframerate()
# 96 kHz -> 32 kHz: windowed-sinc low-pass at 14.5 kHz, then keep every third sample
taps = 63; n = np.arange(taps) - taps // 2
h = np.sinc(2 * 14500 / SR0 * n) * np.hamming(taps); h /= h.sum()
y = np.convolve(x, h, mode='same')[::3]
SR = 32000

a, b = 12.0, 27.0                                   # steady driving, before the vehicle gets close and loud
seg = y[int(a * SR):int(b * SR)].astype(np.float64)
seg -= seg.mean()
# flatten the slow loudness drift (the vehicle approaches): divide by a 1.5 s RMS envelope
win = int(1.5 * SR)
env = np.sqrt(np.convolve(seg ** 2, np.ones(win) / win, mode='same'))
env = np.maximum(env, env.mean() * .3)
seg = seg / env * env.mean()
# loop: the last 1.2 s cross-fades (equal power) into the start
cf = int(1.2 * SR)
t = np.linspace(0, 1, cf)
out = seg[:-cf].copy()
out[:cf] = seg[:cf] * np.sin(t * np.pi / 2) + seg[-cf:] * np.cos(t * np.pi / 2)
out = out / np.abs(out).max() * .89
pcm = (out * 32767).astype('<i2')
with wave.open(os.path.join(HERE, '..', 'web', 'assets', 'tank_drive.wav'), 'wb') as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
print('loop', round(len(out) / SR, 2), 's', round(len(pcm) * 2 / 1e6, 2), 'MB')
# check the seam: loudness of the 0.25 s around the joint vs the average
j = np.concatenate([out[-SR // 8:], out[:SR // 8]])
print('rms joint/avg', round(np.sqrt((j ** 2).mean()) / np.sqrt((out ** 2).mean()), 3))
