#!/usr/bin/env bash
# what the emulator showed when the e2e flows failed (e2e.yml, after `maestro test`): the activity
# on top, the app process, the elements on screen, the activity starts and the app's own log.
# text output only: no screenshot or artifact leaves the runner, since one could show the test
# account email; the test account values are github secrets, masked in any output. always exits 1,
# so the step still fails
set -uo pipefail

APP_ID='io.github.nidroz.tsuzuki.dev'
APP_LOG_LINES=300
START_LINES=40
UI_DUMP='/sdcard/e2e-ui.xml'

echo '::group::activity on top'
adb shell dumpsys activity activities | grep -E 'topResumedActivity|mResumedActivity' || true
echo '::endgroup::'

echo '::group::app process'
pid="$(adb shell pidof "$APP_ID" | tr -d '\r')"
echo "${pid:-${APP_ID} is not running}"
echo '::endgroup::'

# the text, ids and descriptions of the elements on screen, one per line
echo '::group::elements on screen'
if adb shell uiautomator dump "$UI_DUMP" > /dev/null 2>&1; then
  adb shell cat "$UI_DUMP" | grep -oE '(text|resource-id|content-desc)="[^"]+"' || true
else
  echo 'uiautomator dump failed'
fi
echo '::endgroup::'

# whether the dev-client link reached the app: the activity starts and the app's crashes or anrs
echo '::group::activity starts'
adb logcat -d | grep -E "START u0|${APP_ID}" | grep -vE 'uiautomator' | tail -n "$START_LINES" || true
echo '::endgroup::'

# the app's own log (dev launcher, react native, javascript), else those tags from any process
echo '::group::app log'
if [[ -n "$pid" ]]; then
  adb logcat -d -t "$APP_LOG_LINES" --pid="$pid" || true
else
  adb logcat -d -t "$APP_LOG_LINES" -s DevLauncher ReactNativeJS ReactNative AndroidRuntime || true
fi
echo '::endgroup::'

exit 1
