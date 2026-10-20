#!/usr/bin/env bash
# Synthesizes the simple SFX the timeline uses (public/sfx/*.wav) with ffmpeg only, so there is
# nothing to license. Re-run any time; Demo.tsx plays a cue only if its file exists.
set -euo pipefail
cd "$(dirname "$0")/.."
out=public/sfx
mkdir -p "$out"
ff() { ffmpeg -loglevel error -y "$@"; }
R=48000

# whoosh: band-passed pink noise with a swelling envelope
ff -f lavfi -i "anoisesrc=color=pink:d=0.7:r=$R:a=0.9" \
  -af "bandpass=f=900:width_type=o:w=2,volume='pow(sin(PI*t/0.7),2)*2.2':eval=frame,afade=t=out:st=0.6:d=0.1" \
  -ac 2 "$out/whoosh.wav"

# impact: falling sub thump + a short noise crack
ff -f lavfi -i "aevalsrc='0.9*sin(2*PI*(110*t-50*t*t))*exp(-5*t)':d=1.2:s=$R" \
   -f lavfi -i "anoisesrc=color=white:d=0.15:r=$R:a=0.6" \
  -filter_complex "[1]highpass=f=1500,afade=t=out:st=0:d=0.15[n];[0][n]amix=inputs=2:normalize=0,alimiter=limit=0.9" \
  -ac 2 "$out/impact.wav"

# dice: a handful of decaying wooden clicks
ff -f lavfi -i "aevalsrc='0.7*(sin(2*PI*2300*t)*exp(-90*t) + sin(2*PI*1900*(t-0.11))*exp(-90*(t-0.11))*gt(t,0.11) + sin(2*PI*2600*(t-0.19))*exp(-80*(t-0.19))*gt(t,0.19) + 0.7*sin(2*PI*2100*(t-0.32))*exp(-90*(t-0.32))*gt(t,0.32) + 0.5*sin(2*PI*2400*(t-0.41))*exp(-100*(t-0.41))*gt(t,0.41) + 0.35*sin(2*PI*2200*(t-0.47))*exp(-100*(t-0.47))*gt(t,0.47))':d=0.8:s=$R" \
  -af "lowpass=f=6000,alimiter=limit=0.9" -ac 2 "$out/dice.wav"

# chime: bell-like partials with a long decay
ff -f lavfi -i "aevalsrc='0.35*(sin(2*PI*880*t) + 0.6*sin(2*PI*1320*t) + 0.4*sin(2*PI*1760*t) + 0.25*sin(2*PI*2640*t))*exp(-2.2*t)':d=2:s=$R" \
  -af "aecho=0.8:0.6:120:0.3,alimiter=limit=0.9" -ac 2 "$out/chime.wav"

# sword: inharmonic metallic ring + a scrape of noise
ff -f lavfi -i "aevalsrc='0.4*(sin(2*PI*2100*t)+0.7*sin(2*PI*3170*t)+0.5*sin(2*PI*4430*t))*exp(-7*t)':d=1:s=$R" \
   -f lavfi -i "anoisesrc=color=white:d=0.25:r=$R:a=0.5" \
  -filter_complex "[1]highpass=f=3000,afade=t=out:st=0:d=0.25[n];[0][n]amix=inputs=2:normalize=0,alimiter=limit=0.9" \
  -ac 2 "$out/sword.wav"

# stamp: low thud + paper slap
ff -f lavfi -i "aevalsrc='0.9*sin(2*PI*70*t)*exp(-14*t)':d=0.5:s=$R" \
   -f lavfi -i "anoisesrc=color=brown:d=0.08:r=$R:a=0.8" \
  -filter_complex "[1]afade=t=out:st=0:d=0.08[n];[0][n]amix=inputs=2:normalize=0,alimiter=limit=0.9" \
  -ac 2 "$out/stamp.wav"

ls -1 "$out"
