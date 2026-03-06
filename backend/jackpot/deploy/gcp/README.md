# GCP Production Deploy (Cloud Run + Scheduler)

This deploy path runs:
- API service on Cloud Run (`npm start`)
- Listener as Cloud Run Job (`npm run listener:once`)
- Cloud Scheduler triggers listener job every minute

## Prerequisites
- gcloud CLI installed and authenticated
- billing enabled on the GCP project
- Firebase project: `jumper-b15aa`
- one service account for Cloud Run + Scheduler

## 1) Upload secrets

```powershell
cd backend/jackpot
.\deploy\gcp\set-secrets.ps1 `
  -ProjectId "jumper-b15aa" `
  -FirebaseClientEmail "firebase-adminsdk-xxxx@jumper-b15aa.iam.gserviceaccount.com" `
  -FirebasePrivateKey "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n" `
  -HotWalletPrivateKey "0x..." `
  -AdminApiKey "replace_admin_api_key" `
  -JackpotHmacSecret "replace_with_long_random_secret"
```

## 2) Deploy API + Job + Scheduler

```powershell
.\deploy\gcp\deploy.ps1 `
  -ProjectId "jumper-b15aa" `
  -Region "asia-southeast1" `
  -ServiceAccount "jackpot-runtime@jumper-b15aa.iam.gserviceaccount.com"
```

After deploy, script prints API URL.

## 3) Connect Netlify frontend

Set jackpot API base in `index.html`:
```html
<script>window.__jackpotApiBase = "https://YOUR_API_URL";</script>
```

## 4) Firestore indexes deploy

From project root:
```powershell
firebase deploy --only firestore:indexes
```

## 5) Verify

- `GET https://YOUR_API_URL/health`
- `GET https://YOUR_API_URL/jackpot/current`
- Cloud Run Job manual run:
```powershell
gcloud run jobs execute jumper-jackpot-listener --region asia-southeast1
```
