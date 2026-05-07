Set-Location -Path $PSScriptRoot
$env:EXPO_NO_TELEMETRY = '1'
$env:REACT_NATIVE_PACKAGER_HOSTNAME = '10.160.24.195'
node node_modules\expo\bin\cli start --lan --port 8082
