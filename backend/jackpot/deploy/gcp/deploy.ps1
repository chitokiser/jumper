param(
  [Parameter(Mandatory = $true)][string]$ProjectId,
  [string]$Region = "asia-southeast1",
  [string]$Repo = "jumper",
  [string]$Image = "jackpot",
  [string]$ApiService = "jumper-jackpot-api",
  [string]$ListenerJob = "jumper-jackpot-listener",
  [string]$SchedulerJob = "jumper-jackpot-listener-every-minute",
  [Parameter(Mandatory = $true)][string]$ServiceAccount,
  [string]$SecretPrefix = "JACKPOT",
  [string]$Schedule = "* * * * *",
  [string]$TimeZone = "Asia/Bangkok"
)

$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "../..")
Set-Location $root

$registry = "$Region-docker.pkg.dev"
$imageUrl = "$registry/$ProjectId/$Repo/$Image:latest"

Write-Host "[1/8] Set gcloud project"
gcloud config set project $ProjectId | Out-Null

Write-Host "[2/8] Enable required APIs"
gcloud services enable `
  run.googleapis.com `
  artifactregistry.googleapis.com `
  cloudscheduler.googleapis.com `
  secretmanager.googleapis.com `
  cloudbuild.googleapis.com

Write-Host "[3/8] Ensure Artifact Registry repo exists"
$repoExists = gcloud artifacts repositories list --location=$Region --filter="name~$Repo" --format="value(name)"
if (-not $repoExists) {
  gcloud artifacts repositories create $Repo --repository-format=docker --location=$Region --description="Jumper containers"
}

Write-Host "[4/8] Build and push image: $imageUrl"
gcloud builds submit --tag $imageUrl .

$saArg = @()
if ($ServiceAccount) {
  $saArg = @("--service-account", $ServiceAccount)
}

Write-Host "[5/8] Deploy API service: $ApiService"
gcloud run deploy $ApiService `
  --image $imageUrl `
  --region $Region `
  --allow-unauthenticated `
  --port 8787 `
  --set-env-vars "NODE_ENV=production" `
  --set-secrets "FIREBASE_CLIENT_EMAIL=$SecretPrefix`_FIREBASE_CLIENT_EMAIL:latest,FIREBASE_PRIVATE_KEY=$SecretPrefix`_FIREBASE_PRIVATE_KEY:latest,HOT_WALLET_PRIVATE_KEY=$SecretPrefix`_HOT_WALLET_PRIVATE_KEY:latest,ADMIN_API_KEY=$SecretPrefix`_ADMIN_API_KEY:latest,JACKPOT_HMAC_SECRET=$SecretPrefix`_JACKPOT_HMAC_SECRET:latest" `
  --set-env-vars "FIREBASE_PROJECT_ID=$ProjectId,FIREBASE_STORAGE_BUCKET=$ProjectId.firebasestorage.app" `
  @saArg

Write-Host "[6/8] Deploy listener job: $ListenerJob"
gcloud run jobs deploy $ListenerJob `
  --image $imageUrl `
  --region $Region `
  --tasks 1 `
  --max-retries 1 `
  --task-timeout 15m `
  --command npm `
  --args run,listener:once `
  --set-env-vars "NODE_ENV=production" `
  --set-secrets "FIREBASE_CLIENT_EMAIL=$SecretPrefix`_FIREBASE_CLIENT_EMAIL:latest,FIREBASE_PRIVATE_KEY=$SecretPrefix`_FIREBASE_PRIVATE_KEY:latest,HOT_WALLET_PRIVATE_KEY=$SecretPrefix`_HOT_WALLET_PRIVATE_KEY:latest,ADMIN_API_KEY=$SecretPrefix`_ADMIN_API_KEY:latest,JACKPOT_HMAC_SECRET=$SecretPrefix`_JACKPOT_HMAC_SECRET:latest" `
  --set-env-vars "FIREBASE_PROJECT_ID=$ProjectId,FIREBASE_STORAGE_BUCKET=$ProjectId.firebasestorage.app" `
  @saArg

Write-Host "[7/8] Create or update scheduler job: $SchedulerJob"
$uri = "https://$Region-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/$ProjectId/jobs/$ListenerJob:run"
$exists = gcloud scheduler jobs list --location=$Region --filter="name~$SchedulerJob" --format="value(name)"
if ($exists) {
  gcloud scheduler jobs update http $SchedulerJob `
    --location $Region `
    --schedule "$Schedule" `
    --time-zone "$TimeZone" `
    --uri $uri `
    --http-method POST `
    --oauth-service-account-email $ServiceAccount `
    --oauth-token-scope "https://www.googleapis.com/auth/cloud-platform"
} else {
  gcloud scheduler jobs create http $SchedulerJob `
    --location $Region `
    --schedule "$Schedule" `
    --time-zone "$TimeZone" `
    --uri $uri `
    --http-method POST `
    --oauth-service-account-email $ServiceAccount `
    --oauth-token-scope "https://www.googleapis.com/auth/cloud-platform"
}

Write-Host "[8/8] Read API URL"
$apiUrl = gcloud run services describe $ApiService --region $Region --format "value(status.url)"
Write-Host "Done. Set window.__jackpotApiBase to: $apiUrl"

