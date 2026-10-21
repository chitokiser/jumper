# 운영 알림 설정 (한 번만 실행, 다시 실행해도 중복 생성하지 않음)
#   .\scripts\setup-monitoring.ps1
# 1) 알림 받을 이메일 채널
# 2) 게임 서버 상태 확인 (5분마다 /health) + 실패 알림
# 3) 서버 함수 오류 기록 수 지표 + 5분에 10건 넘으면 알림 (결제 계정 꺼짐 같은 사고도 여기로 잡힘)
param(
  [string]$Project = "jumper-b15aa",
  [string]$Email = "daguri75@gmail.com",
  [string]$GameHost = "jumper-game-server-production.up.railway.app"
)
$ErrorActionPreference = "Stop"
$tmp = Join-Path $env:TEMP "bestclub-monitoring"
New-Item -ItemType Directory -Force $tmp | Out-Null

function Write-Json($name, $obj) {
  $path = Join-Path $tmp $name
  [System.IO.File]::WriteAllText($path, ($obj | ConvertTo-Json -Depth 20), (New-Object System.Text.UTF8Encoding $false))
  return $path
}

# ── 1) 이메일 채널 ──────────────────────────────────────────────────────────
$channel = (gcloud beta monitoring channels list --project $Project --filter "type=email AND labels.email_address=$Email" --format "value(name)") | Select-Object -First 1
if (-not $channel) {
  $channel = gcloud beta monitoring channels create --project $Project --display-name "BestClub 관리자 ($Email)" --type email --channel-labels "email_address=$Email" --format "value(name)"
  Write-Host "이메일 채널 만듦: $channel"
} else { Write-Host "이메일 채널 있음: $channel" }

# ── 2) 게임 서버 상태 확인 ──────────────────────────────────────────────────
$checkName = "BestClub 게임 서버 health"
$check = (gcloud monitoring uptime list-configs --project $Project --filter "displayName=`"$checkName`"" --format "value(name)") | Select-Object -First 1
if (-not $check) {
  gcloud monitoring uptime create $checkName --project $Project --resource-type uptime-url --resource-labels "host=$GameHost,project_id=$Project" --protocol https --path /health --period 5 --timeout 10 | Out-Null
  $check = (gcloud monitoring uptime list-configs --project $Project --filter "displayName=`"$checkName`"" --format "value(name)") | Select-Object -First 1
  Write-Host "게임 서버 상태 확인 만듦: $check"
} else { Write-Host "게임 서버 상태 확인 있음: $check" }
$checkId = ($check -split "/")[-1]

# ── 3) 서버 함수 오류 지표 ──────────────────────────────────────────────────
$metric = "bestclub_function_errors"
$exists = (gcloud logging metrics list --project $Project --filter "name=$metric" --format "value(name)") | Select-Object -First 1
if (-not $exists) {
  gcloud logging metrics create $metric --project $Project --description "서버 함수(Cloud Run) 오류 기록 수" --log-filter 'resource.type="cloud_run_revision" AND severity>=ERROR' | Out-Null
  Write-Host "오류 지표 만듦: $metric"
} else { Write-Host "오류 지표 있음: $metric" }

# ── 알림 정책 ───────────────────────────────────────────────────────────────
$policies = gcloud alpha monitoring policies list --project $Project --format "value(displayName)"

if ($policies -notcontains "게임 서버 응답 없음") {
  $p = Write-Json "uptime-policy.json" @{
    displayName = "게임 서버 응답 없음"
    combiner = "OR"
    notificationChannels = @($channel)
    documentation = @{ content = "게임 서버($GameHost/health)가 응답하지 않습니다. Railway 배포·로그를 확인하세요."; mimeType = "text/markdown" }
    conditions = @(@{
      displayName = "health 확인 실패"
      conditionThreshold = @{
        filter = "metric.type=`"monitoring.googleapis.com/uptime_check/check_passed`" AND metric.label.check_id=`"$checkId`" AND resource.type=`"uptime_url`""
        aggregations = @(@{ alignmentPeriod = "600s"; perSeriesAligner = "ALIGN_NEXT_OLDER"; crossSeriesReducer = "REDUCE_COUNT_FALSE"; groupByFields = @("resource.label.host") })
        comparison = "COMPARISON_GT"; thresholdValue = 1; duration = "600s"
        trigger = @{ count = 1 }
      }
    })
  }
  gcloud alpha monitoring policies create --project $Project --policy-from-file $p | Out-Null
  Write-Host "알림 정책 만듦: 게임 서버 응답 없음"
} else { Write-Host "알림 정책 있음: 게임 서버 응답 없음" }

if ($policies -notcontains "서버 함수 오류 급증") {
  $p = Write-Json "errors-policy.json" @{
    displayName = "서버 함수 오류 급증"
    combiner = "OR"
    notificationChannels = @($channel)
    documentation = @{ content = "서버 함수 오류가 5분에 10건을 넘었습니다. 결제 계정 상태(billing)와 함수 로그를 확인하세요."; mimeType = "text/markdown" }
    conditions = @(@{
      displayName = "오류 5분 10건 초과"
      conditionThreshold = @{
        filter = "metric.type=`"logging.googleapis.com/user/$metric`" AND resource.type=`"cloud_run_revision`""
        aggregations = @(@{ alignmentPeriod = "300s"; perSeriesAligner = "ALIGN_DELTA"; crossSeriesReducer = "REDUCE_SUM" })
        comparison = "COMPARISON_GT"; thresholdValue = 10; duration = "0s"
        trigger = @{ count = 1 }
      }
    })
  }
  gcloud alpha monitoring policies create --project $Project --policy-from-file $p | Out-Null
  Write-Host "알림 정책 만듦: 서버 함수 오류 급증"
} else { Write-Host "알림 정책 있음: 서버 함수 오류 급증" }

Write-Host "`n완료 — 알림은 $Email 로 갑니다."
