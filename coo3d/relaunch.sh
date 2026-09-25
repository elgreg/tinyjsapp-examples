#!/bin/bash
# Quit any running Coo 3D (dist build or installed copy), then open the
# dist build. --build rebuilds first and stops if the build fails.
# Usage (from anywhere): coo3d/relaunch.sh [--build]
set -u
cd "$(dirname "$0")"

if [ "${1:-}" = "--build" ]; then
  ../../tinyjsapp/tinyjs build || { echo "build failed; not relaunching" >&2; exit 1; }
fi

pat='Coo 3D\.app/Contents/MacOS/'
if pgrep -f "$pat" >/dev/null; then
  pkill -TERM -f "$pat"
  for _ in $(seq 20); do pgrep -f "$pat" >/dev/null || break; sleep 0.25; done
  pkill -KILL -f "$pat" 2>/dev/null   # anything that ignored the TERM
  sleep 0.5   # let LaunchServices notice it's gone
fi

# Right after a kill, LaunchServices can still list the dead copy as running
# and `open` fails with -600 (procNotFound). Retry until it lets go.
for i in 1 2 3 4 5 6; do
  open "dist/Coo 3D.app" 2>/dev/null && exit 0
  sleep 0.5
done
open "dist/Coo 3D.app"   # last try, with its error visible
