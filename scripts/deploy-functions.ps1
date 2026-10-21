# 서버 함수 배포 (안전장치 포함)
#   .\scripts\deploy-functions.ps1 payMerchantFirebase,receiveBtQrFirebase
#   .\scripts\deploy-functions.ps1 rules            ← 보안 규칙만
# 1) 이 폴더가 GitHub(origin/master) 최신과 같고 functions/ 에 커밋 안 된 변경이 없는지 검사 (scripts/predeploy-check.cjs)
# 2) 통과하면 firebase deploy 실행
# 고친 서버 코드는 커밋·푸시 후 바로 이 스크립트로 배포한다 (2026-10 수정이 배포 안 돼 결제 BT 누락된 일 재발 방지)
param(
  [Parameter(Mandatory = $true)][string[]]$Names,
  [string]$Project = "jumper-b15aa",
  [string]$Firebase = "firebase"
)
$ErrorActionPreference = "Stop"
Remove-Item Env:VSCODE_CWD -ErrorAction SilentlyContinue
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

node "$PSScriptRoot\predeploy-check.cjs"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$targets = ($Names | ForEach-Object { $_ -split "," } | Where-Object { $_ } | ForEach-Object {
  if ($_ -eq "rules") { "firestore:rules" } else { "functions:$_" }
}) -join ","
Write-Host "배포 대상: $targets"
& $Firebase deploy --only $targets --project $Project
exit $LASTEXITCODE
