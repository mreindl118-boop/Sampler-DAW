#!/usr/bin/env sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
test -f "$root/app/src/main/assets/app/index.html" || { echo 'Run npm run native:sync from the repository root first.' >&2; exit 1; }
command -v gradle >/dev/null || { echo 'Install Gradle 8.13, JDK17 and Android SDK platform 36. See docs/NATIVE_MIDI.md.' >&2; exit 1; }
case "${1:-debug}" in
  debug) task=:app:assembleDebug ;;
  release) task=:app:assembleRelease ;;
  *) echo 'Usage: sh build.sh [debug|release]' >&2; exit 1 ;;
esac
gradle -p "$root" "$task" :app:lintDebug
