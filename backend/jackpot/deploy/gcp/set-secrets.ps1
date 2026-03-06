param(
  [Parameter(Mandatory = $true)][string]$ProjectId,
  [string]$SecretPrefix = "JACKPOT",
  [Parameter(Mandatory = $true)][string]$FirebaseClientEmail,
  [Parameter(Mandatory = $true)][string]$FirebasePrivateKey,
  [Parameter(Mandatory = $true)][string]$HotWalletPrivateKey,
  [Parameter(Mandatory = $true)][string]$AdminApiKey,
  [Parameter(Mandatory = $true)][string]$JackpotHmacSecret
)

$ErrorActionPreference = "Stop"
gcloud config set project $ProjectId | Out-Null

function Upsert-Secret([string]$Name, [string]$Value) {
  $exists = gcloud secrets list --filter="name:$Name" --format="value(name)"
  $tmp = New-TemporaryFile
  try {
    Set-Content -Path $tmp -Value $Value -NoNewline -Encoding utf8
    if ($exists) {
      gcloud secrets versions add $Name --data-file=$tmp | Out-Null
    } else {
      gcloud secrets create $Name --replication-policy="automatic" | Out-Null
      gcloud secrets versions add $Name --data-file=$tmp | Out-Null
    }
  } finally {
    Remove-Item $tmp -ErrorAction SilentlyContinue
  }
}

Upsert-Secret "$SecretPrefix`_FIREBASE_CLIENT_EMAIL" $FirebaseClientEmail
Upsert-Secret "$SecretPrefix`_FIREBASE_PRIVATE_KEY" $FirebasePrivateKey
Upsert-Secret "$SecretPrefix`_HOT_WALLET_PRIVATE_KEY" $HotWalletPrivateKey
Upsert-Secret "$SecretPrefix`_ADMIN_API_KEY" $AdminApiKey
Upsert-Secret "$SecretPrefix`_JACKPOT_HMAC_SECRET" $JackpotHmacSecret

Write-Host "Secrets uploaded." 
