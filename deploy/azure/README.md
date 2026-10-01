# Self-hosting on Azure

`containerapp.yaml` is the definition of the WhatBuild container app on Azure Container Apps, with
`${NAME}` placeholders. There is no setup script: an agent creates the deployment with the Azure
CLI by following the `azure-self-host` skill (`.agents/skills/azure-self-host/SKILL.md`), and
everything it needs to know is in [okf/operations/azure.md](../../okf/operations/azure.md): the
resources, their settings, the commands, sign-in and the variations.

Nothing here is used by the Cloud Run deployment in `deploy/cloud-run/`, and nothing there is used
here.
