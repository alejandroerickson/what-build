# Cloud Run deployment

`setup.sh` creates a complete WhatBuild deployment on Google Cloud Run in the project you name with
`PROJECT_ID` (image repository, runtime identity, bucket, secrets, database, migration job and
service), and is safe to re-run; its header lists every setting. How the deployment works, sign-in,
continuous deployment and costs: [okf/operations/cloud-run.md](../../okf/operations/cloud-run.md).
If a deploy breaks it: [okf/operations/recovering-from-a-bad-release.md](../../okf/operations/recovering-from-a-bad-release.md).
