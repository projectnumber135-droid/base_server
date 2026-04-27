$source = "c:\FileServer"
$staging = "c:\FileServer_Staging"
$zipPath = "c:\FileServer\FileServer.zip"

if (Test-Path $staging) { Remove-Item -Recurse -Force $staging }
if (Test-Path $zipPath) { Remove-Item -Force $zipPath }

New-Item -ItemType Directory -Path $staging | Out-Null

Get-ChildItem -Path $source -Force -Exclude node_modules, uploads, pm2, FileServer.zip | Copy-Item -Destination $staging -Recurse -Force

New-Item -ItemType Directory -Path "$staging\uploads" | Out-Null

New-Item -ItemType Directory -Path "$staging\pm2" | Out-Null
New-Item -ItemType Directory -Path "$staging\pm2\logs" | Out-Null
New-Item -ItemType Directory -Path "$staging\pm2\pids" | Out-Null

Get-ChildItem -Path "$source\pm2" -Force -Exclude *.log, *.pid, logs, pids | Copy-Item -Destination "$staging\pm2" -Recurse -Force

Compress-Archive -Path "$staging\*" -DestinationPath $zipPath

Remove-Item -Recurse -Force $staging
