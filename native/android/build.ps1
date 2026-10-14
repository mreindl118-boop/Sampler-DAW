param([ValidateSet('debug','release')][string]$Configuration = 'debug')
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'app/src/main/assets/app/index.html'))) {
    throw 'Build and sync the web assets first: npm run native:sync from the repository root.'
}
if (-not (Get-Command gradle -ErrorAction SilentlyContinue)) {
    throw 'Install Gradle 8.13 and JDK 17, set ANDROID_HOME to an Android SDK with platform 36, then retry. See docs/NATIVE_MIDI.md.'
}
$task = if ($Configuration -eq 'release') { ':app:assembleRelease' } else { ':app:assembleDebug' }
& gradle -p $PSScriptRoot $task ':app:lintDebug'
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
