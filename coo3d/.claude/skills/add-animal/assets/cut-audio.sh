#!/bin/bash
# Cut, clean and normalize clips from a field recording into short mp3s.
#   source cut-audio.sh; SRC=recording.wav OUT=clips BAND="highpass=f=70,lowpass=f=6500"
#   cut b-roar-1 9.3 14.3      # name start end (seconds)
# Birds used BAND="highpass=f=2100,highpass=f=2100,lowpass=f=10000" (kills low hum);
# bears BAND="highpass=f=70,lowpass=f=6500".
# Peak-normalize (NOT loudnorm: on sub-3 s clips it pumps the background hiss
# up). afftdn does gentle denoise; fades avoid clicks.
cut() {
  local F="${BAND:-highpass=f=70,lowpass=f=8000},afftdn=nr=16:nf=-44"
  mkdir -p "${OUT:-clips}"
  ffmpeg -hide_banner -loglevel error -y -ss "$2" -to "$3" -i "$SRC" -ac 1 -af "$F" -ar "${RATE:-32000}" -f wav "$OUT/.tmp.wav"
  local peak=$(ffmpeg -hide_banner -i "$OUT/.tmp.wav" -af volumedetect -f null - 2>&1 | sed -n 's/.*max_volume: \(-*[0-9.]*\) dB.*/\1/p')
  local gain=$(python3 -c "print(-3 - float('$peak'))")
  ffmpeg -hide_banner -loglevel error -y -i "$OUT/.tmp.wav" \
    -af "volume=${gain}dB,afade=t=in:d=0.02,areverse,afade=t=in:d=0.08,areverse" \
    -c:a libmp3lame -b:a "${KBPS:-64}k" "$OUT/$1.mp3"
  rm -f "$OUT/.tmp.wav"
}
# Bundle:  python3 - <<'EOF'
# import base64, glob, json, os
# bank = {os.path.basename(f)[:-4]: base64.b64encode(open(f,'rb').read()).decode() for f in sorted(glob.glob('clips/*.mp3'))}
# open('src/frontend/<name>-sound.js','w').write('// credits in README\nconst <NAME>_SND_B64 = ' + json.dumps(bank, indent=0) + ';\n')
# EOF
