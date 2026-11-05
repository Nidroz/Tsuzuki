#!/usr/bin/env bash
# what the emulator showed when the e2e flows failed (e2e.yml, after `maestro test`): the activity
# on top, the app process, the elements on screen and the recent warnings and errors of the app.
# text output only: no screenshot or artifact leaves the runner, since one could show the test
# account email; the test account values are github secrets, masked in any output. always exits 1,
# so the step still fails
set -uo pipefail

APP_ID='io.github.nidroz.tsuzuki.dev'
LOGCAT_LINES=400
UI_DUMP='/sdcard/e2e-ui.xml'

echo '::group::activity on top'
adb shell dumpsys activity activities | grep -E 'topResumedActivity|mResumedActivity' || true
echo '::endgroup::'

echo '::group::app process'
adb shell pidof "$APP_ID" || echo "${APP_ID} is not running"
echo '::endgroup::'

# the text, ids and descriptions of the elements on screen, one per line
echo '::group::elements on screen'
if adb shell uiautomator dump "$UI_DUMP" > /dev/null 2>&1; then
  adb shell cat "$UI_DUMP" | grep -oE '(text|resource-id|content-desc)="[^"]+"' || true
else
  echo 'uiautomator dump failed'
fi
echo '::endgroup::'

# javascript logs, react native and dev launcher messages, crashes, and every other error
echo '::group::app log'
adb logcat -d -t "$LOGCAT_LINES" \
  'ReactNativeJS:V' 'ReactNative:V' 'DevLauncher:V' 'expo:V' 'AndroidRuntime:V' '*:E' || true
echo '::endgroup::'

exit 1
