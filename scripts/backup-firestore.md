# Firestore Backup Export

Owner provides the destination bucket. Keep it private, versioned if possible, and in the same Google Cloud project/region policy as EnglishMind.

```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS = "C:\path\to\service-account.json"
gcloud config set project englishmind-45a88
gcloud firestore export gs://<owner-provided-backup-bucket>/firestore/$(Get-Date -Format yyyyMMdd-HHmmss)
```

Restore drill placeholder:

```powershell
gcloud firestore import gs://<owner-provided-backup-bucket>/firestore/<export-folder>
```

Notes:
- Do not commit service account JSON.
- Verify the export appears in Cloud Storage before rotating or deleting production data.
- Use a staging project for restore drills unless owner explicitly approves production restore.
