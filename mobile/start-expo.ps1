Set-Location -Path $PSScriptRoot
$env:EXPO_NO_TELEMETRY = '1'
$env:REACT_NATIVE_PACKAGER_HOSTNAME = '10.160.24.195'

# Dev defaults baked into the running JS bundle. Expo exposes any env
# starting with EXPO_PUBLIC_* to the React Native code via process.env.*.
# Edit IP here when your laptop's LAN address changes.
$env:EXPO_PUBLIC_API_BASE_URL = 'http://10.160.24.195:4000'
$env:EXPO_PUBLIC_API_KEY = 'dev-local-key-change-me'

node node_modules\expo\bin\cli start --lan --port 8082
