---
type: System Concept
title: WhatBuild self-hosts on Azure Container Apps with Azure Database for PostgreSQL and a mounted file share, set up by an agent with the Azure CLI.
description: What a self-hosted deployment on Azure is made of, how each resource is configured, the commands that create it, sign-in with a Microsoft work account, the variations between organizations, deploying a new version, cost and removal.
tags: [operations, deployment, azure, self-hosting, container-apps, entra]
generated: {by: agent:claude, at: 2026-10-02}
status: draft
---

# Self-hosting WhatBuild on Azure

The same image the [Cloud Run deployment](cloud-run.md) runs, on Azure, for an organization that
keeps its own copy. It is not a separate mode of the product
([§2.7](../spec/02-architecture.md)): the image, the migrations and the settings are the same, and
only the host differs. Nothing here touches the Cloud Run deployment: the files are in
[`deploy/azure/`](../../deploy/azure/README.md), the values in `.env.azure`, and no file the
Cloud Run deployment reads is changed
([decision](../decisions/self-hosting-on-azure-is-agent-led-and-shares-nothing-with-cloud-run.md)).

There is no setup script. An agent with the Azure CLI creates the deployment by following this
guide, because what differs between organizations (directories, policies, networks, who may do
what) is easier to ask about and adapt to than to parameterize. Agents: the
`azure-self-host` skill in `.agents/skills/` is the procedure; this guide is what it reads.

**Draft.** The commands have been run once, into a subscription with Azure CLI 2.86, with the app
registration in another directory; the last check, a sign-in and an upload, waits on its operator
([roadmap](../spec/10-roadmap.md#self-hosting-on-azure)). Flags move between CLI versions: when a command refuses one, read `az <command> --help` and adapt. Whoever
finds a step wrong corrects it here and sends the correction back as a pull request; the skill
says how, and what must not travel with it.

```
            ┌───────────── Container App "whatbuild" (one replica at most) ──────────┐
browser ──▶ │  web app · /api/v1 · /mcp · /oauth · upload relay · job worker        │
agent   ──▶ │  the repository's image, pulled from the registry by managed identity  │
            └──────┬───────────────────────┬───────────────────────────┬─────────────┘
                   │                       │                           │
       Azure Database for          Azure Files share            Key Vault
       PostgreSQL flexible server  mounted at /data/blobs       database URL, grant key,
       rows, search, job queue     files and sidecars           sign-in secrets
```

Before a new image serves, the same image runs as the Container Apps job `whatbuild-migrate`
(`node main.js migrate`), so the schema leads the code.

## What it is made of

Everything except the app registration lives in one resource group in one subscription.

| Resource | Default name | How it is configured | Why |
|---|---|---|---|
| Resource group | `rg-whatbuild` | one region | everything is removed together |
| Container registry | `whatbuild<suffix>` | Basic, admin user off | holds the image; builds run in it, so no local Docker |
| Managed identity (user-assigned) | `id-whatbuild` | `AcrPull` on the registry, `Key Vault Secrets User` on the vault | the app's and the job's only identity; no stored credential |
| Key Vault | `kv-whatbuild-<suffix>` | Azure role-based access | secrets, referenced by the app and the job |
| PostgreSQL flexible server | `psql-whatbuild-<suffix>` | Postgres 17, Burstable `Standard_B1ms`, 32 GiB, 14 days of backups, `pg_trgm` allow-listed, database and role `whatbuild` | every row, the search index, the job queue |
| Storage account and file share | `stwhatbuild<suffix>`, share `whatbuild-files` | StorageV2, locally redundant, SMB share, 30 days of share soft delete | files and parsed sidecars, through the filesystem adapter |
| Log Analytics workspace | `log-whatbuild` | | the app's and the job's logs |
| Container Apps environment | `cae-whatbuild` | the file share registered as storage `whatbuild-files` | hosts the app and the job |
| Container Apps job | `whatbuild-migrate` | manual trigger, same image, `node main.js migrate` | migrations |
| Container app | `whatbuild` | [`containerapp.yaml`](../../deploy/azure/containerapp.yaml): external HTTPS ingress to port 8080, 1 vCPU and 2 GiB, 0 to 1 replicas, the share at `/data/blobs` | the service |
| App registration (Microsoft Entra) | `WhatBuild` | single tenant, web redirect URI `<public URL>/auth/microsoft/callback`, one client secret | sign-in with a work account; in the identity directory |

`<suffix>` is six lowercase letters and digits chosen once, because registry, vault, server and
storage account names are global.

**Files are on a file share, not in Blob Storage.** The server has filesystem, in-memory and Google
Cloud Storage adapters and none for Azure Blob Storage ([§2.4](../spec/02-architecture.md)). The
filesystem adapter on a mounted Azure Files share needs no change to the image and keeps the
image stateless. It costs two things: Container Apps mounts a share only with the storage
account's key, never an identity, and every upload passes through the service.

## Two directories, not two subscriptions

An app registration belongs to a Microsoft Entra directory (a tenant), not to a subscription. A
subscription matters to it only because `az ad` commands act on the directory of whichever
account is active. "The identity subscription" therefore means: the directory behind that
subscription holds the app registration.

| Situation | What changes |
|---|---|
| One subscription | Nothing to switch. `AZ_IDENTITY_TENANT` is the subscription's own directory. |
| Two subscriptions in the same directory | The same. `az ad` reaches that directory from either. |
| Two subscriptions in different directories | Sign in to both. Run the `az ad` commands with the identity directory active; the client secret goes straight from one command into the vault in the other. |
| A directory with no subscription | `az login --tenant <id> --allow-no-subscriptions`, then `az account set --subscription <the tenant id>`. |
| The operator may not register applications | Someone who may creates it, or names an existing one. The operator then needs to be an owner of it, to add the redirect URI and a secret; failing that, its administrator adds the redirect URI and puts a secret in the vault. |
| The directory requires an administrator to consent | An administrator grants consent to `openid`, `profile` and `email` once (below). |

## Before anything is created

Settle these with the person; each changes what is built.

1. **The resource subscription and the identity directory**, by ID. Never the CLI's current
   default: `az account list -o table` shows what is signed in.
2. **Rights.** Owner on the subscription, or on a resource group made for this (Contributor is not
   enough: the role assignments below need Owner or User Access Administrator). With only a
   resource group, someone with rights on the subscription registers the resource providers.
3. **Region**, and whether policy limits regions, requires tags or dictates names.
4. **Whether policy forbids public endpoints** on databases and storage. If so, read
   [Private networking](#private-networking) first: the environment's network cannot be changed
   after it is created.
5. **Whether policy forbids storage account keys.** If so the file share cannot be mounted, and
   the deployment waits for an exemption on this one account or for the Azure Blob adapter
   ([§2.4](../spec/02-architecture.md)).
6. **Who may sign up** (`WB_ALLOWLIST`: addresses and `@domains`) and **who runs the instance**
   (`WB_OWNERS`: addresses; they create organizations and let others;
   [§3.3](../spec/03-accounts-teams-and-identity.md)).
7. **The address.** The Container Apps address (`https://whatbuild.<generated>.<region>.azurecontainerapps.io`)
   or [a domain of the organization's](#a-custom-domain).
8. **Sign-in**, and **which directory** holds the app registration ([Sign-in](#sign-in)): Microsoft
   work accounts, with or without email links.

## The values file

Names and IDs go in `.env.azure` at the root of the clone. Git ignores it (`.env.*`). It never
holds a secret: secrets go to Key Vault, and this file names them. Write each value into it as it
becomes known, so that a later session can continue.

```bash
# .env.azure: names only, never a secret
AZ_SUBSCRIPTION=00000000-0000-0000-0000-000000000000   # where the resources go
AZ_IDENTITY_TENANT=00000000-0000-0000-0000-000000000000 # the directory that holds the app registration
AZ_LOCATION=canadacentral
AZ_RG=rg-whatbuild
AZ_ACR=whatbuilda1b2c3
AZ_IDENTITY=id-whatbuild
AZ_KEYVAULT=kv-whatbuild-a1b2c3
AZ_POSTGRES=psql-whatbuild-a1b2c3
AZ_STORAGE=stwhatbuilda1b2c3
AZ_SHARE=whatbuild-files
AZ_LOGS=log-whatbuild
AZ_ENV=cae-whatbuild
AZ_APP=whatbuild
AZ_JOB=whatbuild-migrate
WB_ALLOWLIST=@example.com
WB_OWNERS=you@example.com
# added as they are created: AZ_IDENTITY_ID, AZ_IDENTITY_PRINCIPAL, AZ_ENV_ID, WB_PUBLIC_URL, WB_MICROSOFT_CLIENT_ID
```

Every block below starts from a shell that has loaded it and defined `put`, which stores what it
reads on standard input as a vault secret without echoing it:

```bash
set -a; . ./.env.azure; set +a
put() { tr -d '\n' | az keyvault secret set --subscription "$AZ_SUBSCRIPTION" --vault-name "$AZ_KEYVAULT" \
  --name "$1" --file /dev/stdin --encoding utf-8 -o none; }
```

Rules the commands follow:

- **Every command names its subscription** (`--subscription "$AZ_SUBSCRIPTION"`). The CLI's default
  is shared by every terminal on the machine and may point anywhere.
- **A secret is generated and stored in one command**, and read back from the vault into a
  variable when a later step needs it. It is never printed, written into the clone, or put in
  `.env.azure`. `az keyvault secret set` prints the value unless told `-o none`.
- **Check before creating** (`az … show`), so running a step twice changes nothing.
- The commands are for bash (macOS, Linux, WSL, Azure Cloud Shell). In Git Bash on Windows set
  `MSYS_NO_PATHCONV=1`, or resource IDs that start with `/` are rewritten as file paths; in
  PowerShell, translate, and replace `--file /dev/stdin` with a value passed another way.

## Setting it up

### 1. The CLI, the providers, the resource group

The operator's machine needs a clone of the repository at the commit to deploy, `git`, the Azure
CLI signed in (`az login`), and `openssl`, `perl`, `tar` and `curl`; `psql` if it is there. It
needs neither Node nor Docker: the registry builds the image.

```bash
az version                                          # a release from 2026; older ones name some flags differently
az extension add --name containerapp --upgrade      # `az upgrade`, or the package manager that installed it, for the CLI itself
az account show --subscription "$AZ_SUBSCRIPTION" --query "{name:name, tenant:tenantId, user:user.name}" -o table
az account set --subscription "$AZ_SUBSCRIPTION"   # for the two commands that take no --subscription
for ns in Microsoft.App Microsoft.OperationalInsights Microsoft.ContainerRegistry \
          Microsoft.DBforPostgreSQL Microsoft.KeyVault Microsoft.Storage Microsoft.ManagedIdentity; do
  az provider register --subscription "$AZ_SUBSCRIPTION" --namespace "$ns" --wait
done
az group create --subscription "$AZ_SUBSCRIPTION" -n "$AZ_RG" -l "$AZ_LOCATION" -o none
```

Note the account that was active before `az account set`, and set it back when the work is done.

### 2. The registry and the identity

```bash
az acr create --subscription "$AZ_SUBSCRIPTION" -g "$AZ_RG" -n "$AZ_ACR" --sku Basic --admin-enabled false -o none
az identity create --subscription "$AZ_SUBSCRIPTION" -g "$AZ_RG" -n "$AZ_IDENTITY" -o none
AZ_IDENTITY_ID=$(az identity show --subscription "$AZ_SUBSCRIPTION" -g "$AZ_RG" -n "$AZ_IDENTITY" --query id -o tsv)
AZ_IDENTITY_PRINCIPAL=$(az identity show --subscription "$AZ_SUBSCRIPTION" -g "$AZ_RG" -n "$AZ_IDENTITY" --query principalId -o tsv)
az role assignment create --role AcrPull --assignee-object-id "$AZ_IDENTITY_PRINCIPAL" --assignee-principal-type ServicePrincipal \
  --scope "$(az acr show --subscription "$AZ_SUBSCRIPTION" -g "$AZ_RG" -n "$AZ_ACR" --query id -o tsv)" -o none
```

### 3. The vault and the grant key

The operator's own right to write secrets is a role on the vault; owning the subscription does not
give it. `az ad signed-in-user show` answers for the active account, which must be in the
resource subscription's directory here. Role assignments take a minute or two to apply: a `403`
from the vault straight afterwards means wait, not fix.

```bash
az keyvault create --subscription "$AZ_SUBSCRIPTION" -g "$AZ_RG" -n "$AZ_KEYVAULT" -l "$AZ_LOCATION" --enable-rbac-authorization true -o none
KV_ID=$(az keyvault show --subscription "$AZ_SUBSCRIPTION" -n "$AZ_KEYVAULT" --query id -o tsv)
az role assignment create --role "Key Vault Secrets Officer" --assignee-object-id "$(az ad signed-in-user show --query id -o tsv)" \
  --assignee-principal-type User --scope "$KV_ID" -o none
az role assignment create --role "Key Vault Secrets User" --assignee-object-id "$AZ_IDENTITY_PRINCIPAL" \
  --assignee-principal-type ServicePrincipal --scope "$KV_ID" -o none
openssl rand -base64 48 | put whatbuild-grant-key
```

### 4. Postgres

The server is created with public access off, then turned on with no address allowed yet: a server
created with `--public-access None` refuses firewall rules until it is. The rule named for
`0.0.0.0` then lets connections come from inside Azure, which is how the app reaches it; the
password and TLS guard the rest. Organizations that forbid this use
[private networking](#private-networking).

```bash
openssl rand -base64 30 | tr -d '/+=' | cut -c1-32 | put whatbuild-postgres-admin-password
PG_ADMIN_PW=$(az keyvault secret show --subscription "$AZ_SUBSCRIPTION" --vault-name "$AZ_KEYVAULT" --name whatbuild-postgres-admin-password --query value -o tsv)
az postgres flexible-server create --subscription "$AZ_SUBSCRIPTION" -g "$AZ_RG" -n "$AZ_POSTGRES" -l "$AZ_LOCATION" \
  --tier Burstable --sku-name Standard_B1ms --storage-size 32 --version 17 --backup-retention 14 \
  --admin-user wbadmin --admin-password "$PG_ADMIN_PW" --public-access None --yes -o none
az postgres flexible-server update --subscription "$AZ_SUBSCRIPTION" -g "$AZ_RG" -n "$AZ_POSTGRES" --public-access Enabled -o none
az postgres flexible-server parameter set --subscription "$AZ_SUBSCRIPTION" -g "$AZ_RG" --server-name "$AZ_POSTGRES" \
  --name azure.extensions --value pg_trgm -o none
az postgres flexible-server firewall-rule create --subscription "$AZ_SUBSCRIPTION" -g "$AZ_RG" -n "$AZ_POSTGRES" \
  --rule-name azure-services --start-ip-address 0.0.0.0 --end-ip-address 0.0.0.0 -o none
```

In CLI 2.86 the firewall-rule commands take the server as `-n` and the rule as `--rule-name`, and
warn that a later release swaps them for `--server-name` and `--name`; follow `--help`.

**The role must not bypass row-level security.** WhatBuild refuses to start in production as a
superuser or a role with `BYPASSRLS` ([cloud-run.md](cloud-run.md#setting-it-up) says why), so it
gets a role of its own that owns its database. Azure lets only an administrator create an
extension, so the administrator creates `pg_trgm`, and the first migration's
`CREATE EXTENSION IF NOT EXISTS` then finds it. Azure also gives the new database's `public` schema
to `azure_pg_admin`, not to the database's owner, so the role is given the schema; without it the
migrations stop at `permission denied for schema public`. Open the server to the operator's address for as
long as this takes:

```bash
PG_HOST="$AZ_POSTGRES.postgres.database.azure.com"
MY_IP=$(curl -s https://api.ipify.org)
az postgres flexible-server firewall-rule create --subscription "$AZ_SUBSCRIPTION" -g "$AZ_RG" -n "$AZ_POSTGRES" \
  --rule-name setup-operator --start-ip-address "$MY_IP" --end-ip-address "$MY_IP" -o none
openssl rand -base64 30 | tr -d '/+=' | cut -c1-32 | put whatbuild-postgres-password
WB_DB_PW=$(az keyvault secret show --subscription "$AZ_SUBSCRIPTION" --vault-name "$AZ_KEYVAULT" --name whatbuild-postgres-password --query value -o tsv)
PGPASSWORD="$PG_ADMIN_PW" psql "host=$PG_HOST dbname=postgres user=wbadmin sslmode=require" -v ON_ERROR_STOP=1 -v pw="$WB_DB_PW" <<'SQL'
CREATE ROLE whatbuild LOGIN PASSWORD :'pw';
GRANT whatbuild TO CURRENT_USER;          -- naming an owner needs membership in that role
CREATE DATABASE whatbuild OWNER whatbuild;
\connect whatbuild
CREATE EXTENSION IF NOT EXISTS pg_trgm;
ALTER SCHEMA public OWNER TO whatbuild;   -- Azure gives it to azure_pg_admin
SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'whatbuild';   -- f | f
SQL
printf 'postgres://whatbuild:%s@%s:5432/whatbuild?sslmode=verify-full' "$WB_DB_PW" "$PG_HOST" | put whatbuild-database-url
az postgres flexible-server firewall-rule delete --subscription "$AZ_SUBSCRIPTION" -g "$AZ_RG" -n "$AZ_POSTGRES" \
  --rule-name setup-operator --yes
```

Without `psql`, any Postgres client runs the same statements: `az postgres flexible-server execute`
(extension `rdbms-connect`), one statement per call since `CREATE DATABASE` cannot share a call, or a
few lines of Python with `psycopg` (`uvx --with 'psycopg[binary]' python …`), reading the passwords
from the environment.
On a second run the role exists: `ALTER ROLE whatbuild PASSWORD :'pw'` in place of creating it.
With **a Postgres that already exists** (15 or later, anywhere), skip the server, apply the same
role rule and `pg_trgm`, and store its URL as `whatbuild-database-url`.

### 5. The file share and the environment

```bash
az storage account create --subscription "$AZ_SUBSCRIPTION" -g "$AZ_RG" -n "$AZ_STORAGE" -l "$AZ_LOCATION" \
  --kind StorageV2 --sku Standard_LRS --min-tls-version TLS1_2 --https-only true --allow-blob-public-access false -o none
az storage share-rm create --subscription "$AZ_SUBSCRIPTION" -g "$AZ_RG" --storage-account "$AZ_STORAGE" \
  -n "$AZ_SHARE" --quota 100 --enabled-protocols SMB -o none
az storage account file-service-properties update --subscription "$AZ_SUBSCRIPTION" -g "$AZ_RG" --account-name "$AZ_STORAGE" \
  --enable-delete-retention true --delete-retention-days 30 -o none

az monitor log-analytics workspace create --subscription "$AZ_SUBSCRIPTION" -g "$AZ_RG" -n "$AZ_LOGS" -l "$AZ_LOCATION" -o none
az containerapp env create --subscription "$AZ_SUBSCRIPTION" -g "$AZ_RG" -n "$AZ_ENV" -l "$AZ_LOCATION" \
  --logs-workspace-id "$(az monitor log-analytics workspace show --subscription "$AZ_SUBSCRIPTION" -g "$AZ_RG" -n "$AZ_LOGS" --query customerId -o tsv)" \
  --logs-workspace-key "$(az monitor log-analytics workspace get-shared-keys --subscription "$AZ_SUBSCRIPTION" -g "$AZ_RG" -n "$AZ_LOGS" --query primarySharedKey -o tsv)" -o none
az containerapp env storage set --subscription "$AZ_SUBSCRIPTION" -g "$AZ_RG" -n "$AZ_ENV" --storage-name "$AZ_SHARE" \
  --access-mode ReadWrite --azure-file-account-name "$AZ_STORAGE" --azure-file-share-name "$AZ_SHARE" \
  --azure-file-account-key "$(az storage account keys list --subscription "$AZ_SUBSCRIPTION" -g "$AZ_RG" -n "$AZ_STORAGE" --query '[0].value' -o tsv)" -o none
AZ_ENV_ID=$(az containerapp env show --subscription "$AZ_SUBSCRIPTION" -g "$AZ_RG" -n "$AZ_ENV" --query id -o tsv)
WB_PUBLIC_URL="https://$AZ_APP.$(az containerapp env show --subscription "$AZ_SUBSCRIPTION" -g "$AZ_RG" -n "$AZ_ENV" --query properties.defaultDomain -o tsv)"
```

The app's address is known here, before the app exists, which is what the app registration and
`WHATBUILD_PUBLIC_URL` need. Share soft delete brings back a deleted share, not a deleted file;
for file history, back the share up daily with Azure Backup (a Recovery Services vault and
`az backup protection enable-for-azurefileshare`).

### 6. The image

The registry builds it. The build is of a commit, never of the working tree, and the registry is
sent an export of that commit with `.dockerignore` removed: `az acr build` applies that file
itself when it uploads, and mishandles one that excludes everything and then lists what to keep,
as this repository's does. An export holds only tracked files, which is all the file was
protecting.

```bash
WB_IMAGE_TAG=$(git rev-parse --short=7 HEAD)
SRC=$(mktemp -d); git archive HEAD | tar -x -C "$SRC"; rm "$SRC/.dockerignore"
az acr build --subscription "$AZ_SUBSCRIPTION" -r "$AZ_ACR" -t "whatbuild:$WB_IMAGE_TAG" "$SRC"
rm -rf "$SRC"
```

Where registry builds are not allowed on the subscription, build with Docker for `linux/amd64`,
`az acr login -n "$AZ_ACR"`, and push the same tag.

### 7. Migrations

The job reads the configuration the server does, so it needs the grant key as well as the
database URL.

```bash
KV="https://$AZ_KEYVAULT.vault.azure.net/secrets"
az containerapp job create --subscription "$AZ_SUBSCRIPTION" -g "$AZ_RG" -n "$AZ_JOB" --environment "$AZ_ENV" \
  --trigger-type Manual --replica-timeout 600 --replica-retry-limit 0 --replica-completion-count 1 --parallelism 1 \
  --image "$AZ_ACR.azurecr.io/whatbuild:$WB_IMAGE_TAG" --cpu 0.5 --memory 1Gi \
  --mi-user-assigned "$AZ_IDENTITY_ID" --registry-server "$AZ_ACR.azurecr.io" --registry-identity "$AZ_IDENTITY_ID" \
  --secrets "database-url=keyvaultref:$KV/whatbuild-database-url,identityref:$AZ_IDENTITY_ID" \
            "grant-key=keyvaultref:$KV/whatbuild-grant-key,identityref:$AZ_IDENTITY_ID" \
  --env-vars DATABASE_URL=secretref:database-url WHATBUILD_GRANT_KEY=secretref:grant-key \
  --command node --args main.js migrate -o none

EXEC=$(az containerapp job start --subscription "$AZ_SUBSCRIPTION" -g "$AZ_RG" -n "$AZ_JOB" --query name -o tsv)
while :; do
  s=$(az containerapp job execution show --subscription "$AZ_SUBSCRIPTION" -g "$AZ_RG" -n "$AZ_JOB" --job-execution-name "$EXEC" --query properties.status -o tsv)
  case "$s" in Succeeded|Failed|Stopped|Degraded) break ;; esac; sleep 5
done; echo "$s"
```

Go on only after `Succeeded`. Otherwise read the execution's log
(`az containerapp job logs show`, or the `ContainerAppConsoleLogs_CL` table in the workspace). A
failure to read a secret minutes after step 3 is the role assignment still applying.

### 8. The app

Copy the definition out of the clone, uncomment the optional blocks that apply
([Sign-in](#sign-in)), fill in the placeholders, and create the app. Comment lines are left as
they are, and an unset name stops the command.

```bash
export AZ_IDENTITY_ID AZ_ENV_ID WB_IMAGE_TAG WB_PUBLIC_URL
OUT=$(mktemp -d)
cp deploy/azure/containerapp.yaml "$OUT/template.yaml"          # edit this copy
perl -pe 'next if /^\s*#/; s/\$\{(\w+)\}/exists $ENV{$1} ? $ENV{$1} : die "unset: $1\n"/ge' "$OUT/template.yaml" > "$OUT/containerapp.yaml"
az containerapp create --subscription "$AZ_SUBSCRIPTION" -g "$AZ_RG" -n "$AZ_APP" --yaml "$OUT/containerapp.yaml" -o none
rm -rf "$OUT"
```

### 9. Check it

```bash
curl -s "$WB_PUBLIC_URL/health"         # {"status":"ok"}; the first call after a quiet spell waits for a start
curl -s "$WB_PUBLIC_URL/api/v1/meta"    # server_version is the image tag; auth names the sign-in methods that are on
az containerapp logs show --subscription "$AZ_SUBSCRIPTION" -g "$AZ_RG" -n "$AZ_APP" --tail 50
```

Then, signed in: create an organization and a product, upload a document, and see its passages
appear. That one walk proves the database role, the worker and the share; the uploaded file is
then listed by `az storage file list --account-name "$AZ_STORAGE" --share-name "$AZ_SHARE"`. A
start-up error naming `EACCES` under `/data/blobs` means the share is mounted for another user:
add `mountOptions: "uid=1000,gid=1000,dir_mode=0770,file_mode=0660"` to the volume in the
definition (the image runs as `node`, user 1000) and apply it with `az containerapp update --yaml`.

## Sign-in

A production server never logs a sign-in link, so one of these must be on before anyone can sign
in. `GET /api/v1/meta` reports which are.

**Microsoft work accounts** is the method a self-hosted deployment in a Microsoft organization
wants ([§3.2](../spec/03-accounts-teams-and-identity.md#sign-in-with-microsoft-work-accounts)).
It admits accounts of one directory only, the one whose ID is `WHATBUILD_MICROSOFT_TENANT`; a
workforce directory and an Entra External ID directory work alike, and so do guests invited into
either. With the identity directory active (`az account set`; `az ad` takes no `--subscription`):

```bash
T=$(mktemp -d)
cat > "$T/scopes.json" <<'JSON'
[{"resourceAppId": "00000003-0000-0000-c000-000000000000", "resourceAccess": [
  {"id": "37f7f235-527c-4136-accd-4a02d197296e", "type": "Scope"},
  {"id": "14dad69e-099b-42c9-810b-d002981feec1", "type": "Scope"},
  {"id": "64a6cdd6-aab1-4aaf-94b8-3cc8405e90d0", "type": "Scope"}]}]
JSON
WB_MICROSOFT_CLIENT_ID=$(az ad app create --display-name WhatBuild --sign-in-audience AzureADMyOrg \
  --web-redirect-uris "$WB_PUBLIC_URL/auth/microsoft/callback" --required-resource-accesses @"$T/scopes.json" \
  --optional-claims '{"idToken": [{"name": "email", "essential": false}]}' --query appId -o tsv)
az ad sp create --id "$WB_MICROSOFT_CLIENT_ID" -o none
az ad app credential reset --id "$WB_MICROSOFT_CLIENT_ID" --append --display-name whatbuild-sign-in --years 1 \
  --query password -o tsv 2>/dev/null | put whatbuild-microsoft-client-secret
rm -rf "$T"
```

- The last command reads the secret in one directory and stores it in the other's vault without
  showing it. If the vault refuses while the identity directory is active, read the secret into a
  variable, make the resource subscription active again, and store it then.
- The three IDs are Microsoft Graph's delegated `openid`, `profile` and `email`. Where people may
  not consent for themselves, an administrator runs
  `az ad app permission admin-consent --id "$WB_MICROSOFT_CLIENT_ID"` or approves the application
  in the portal.
- `AzureADMyOrg` admits only that directory's accounts, guests included. Who among them may create
  a WhatBuild account is still `WB_ALLOWLIST`. To narrow it in the directory as well, require
  assignment on the enterprise application and assign people or groups.
- The secret expires (a directory may allow less than a year; use `--end-date`). Note the date in
  `.env.azure`. Renewing is the same `credential reset --append` into the same vault secret; the
  app picks a new version up within half an hour, or at once when its revision is restarted.
- The identity directory may be reachable only with another sign-in than the resource
  subscription's: a guest account, or an account signed in to the directory alone
  (`az login --tenant <id> --allow-no-subscriptions`). `az account get-access-token --tenant <id>
  --resource-type ms-graph` then gives a token for Microsoft Graph in that directory, and the same
  objects can be created through Graph (`/applications`, `/servicePrincipals`,
  `/oauth2PermissionGrants`, `/applications/<object id>/addPassword`) without changing the active
  account.
- Uncomment the `microsoft-client-secret` secret and the three `WHATBUILD_MICROSOFT_*` entries in
  the definition before creating the app, or on a running app:

```bash
az containerapp secret set --subscription "$AZ_SUBSCRIPTION" -g "$AZ_RG" -n "$AZ_APP" -o none --secrets \
  "microsoft-client-secret=keyvaultref:https://$AZ_KEYVAULT.vault.azure.net/secrets/whatbuild-microsoft-client-secret,identityref:$AZ_IDENTITY_ID"
az containerapp update --subscription "$AZ_SUBSCRIPTION" -g "$AZ_RG" -n "$AZ_APP" -o none --set-env-vars \
  "WHATBUILD_MICROSOFT_TENANT=$AZ_IDENTITY_TENANT" "WHATBUILD_MICROSOFT_CLIENT_ID=$WB_MICROSOFT_CLIENT_ID" \
  WHATBUILD_MICROSOFT_CLIENT_SECRET=secretref:microsoft-client-secret
```

**Email links** work in every build, and are also what sends invitations. They need an SMTP
server: the organization's own relay, or Azure Communication Services Email, whose SMTP endpoint
is `smtp.azurecomm.net`, port 587, with an SMTP username resource linked to an Entra application
and one of that application's client secrets as the password
([Microsoft's guide](https://learn.microsoft.com/azure/communication-services/quickstarts/email/send-email-smtp/smtp-authentication)).
Store `smtp://<username>:<password>@<host>:587`, with both parts percent-encoded, as
`whatbuild-smtp-url`, and uncomment the `smtp-url` secret, `WHATBUILD_SMTP_URL` and
`WHATBUILD_MAIL_FROM` in the definition. Without mail, invitations are links that whoever invites
copies and sends.

**Google sign-in** works as on Cloud Run ([cloud-run.md](cloud-run.md)), with
`WHATBUILD_GOOGLE_CLIENT_ID` and a vault secret for `WHATBUILD_GOOGLE_CLIENT_SECRET`; a Microsoft
organization rarely wants it.

## Deploying a new version

From a clean checkout of the commit: build, migrate, then move the app. A deploy changes the
image and `WHATBUILD_RELEASE`; every other setting stays.

```bash
WB_IMAGE_TAG=$(git rev-parse --short=7 HEAD)
# build it: step 6, or import a released image (below)
az containerapp job update --subscription "$AZ_SUBSCRIPTION" -g "$AZ_RG" -n "$AZ_JOB" --image "$AZ_ACR.azurecr.io/whatbuild:$WB_IMAGE_TAG" -o none
# start the job and wait for Succeeded: step 7
az containerapp update --subscription "$AZ_SUBSCRIPTION" -g "$AZ_RG" -n "$AZ_APP" \
  --image "$AZ_ACR.azurecr.io/whatbuild:$WB_IMAGE_TAG" --set-env-vars "WHATBUILD_RELEASE=$WB_IMAGE_TAG" -o none
curl -s "$WB_PUBLIC_URL/api/v1/meta"    # server_version is the new tag
```

**From a released image.** A tag `v*` on the repository publishes the image as
`ghcr.io/<owner>/what-build:<tag>` ([decision](../decisions/releases-are-tags-with-a-published-image.md)).
Importing it into the registry replaces the build, and the tag is then the version:

```bash
WB_IMAGE_TAG=v0.1.0
az acr import --subscription "$AZ_SUBSCRIPTION" -n "$AZ_ACR" --source "ghcr.io/<owner>/what-build:$WB_IMAGE_TAG" --image "whatbuild:$WB_IMAGE_TAG"
```

**A pipeline of your own.** The three commands above are all a deploy is, so the usual shape is a
small repository of the organization's that pins a release, runs them from a workflow signed in
by OIDC to an identity with `AcrPush` and `Container Registry Tasks Contributor` on the registry
and `Container Apps Contributor` and `Container Apps Jobs Contributor` on the resource group, and
holds the approvals. That repository is the organization's; this one documents the steps.

Changing a setting is `az containerapp update --set-env-vars NAME=value` (the same variables as
[cloud-run.md](cloud-run.md), with the `WHATBUILD_` prefix); a secret is a new version in the
vault.

## Variations

### A custom domain

Create a `CNAME` from the host to the app's address, and a `TXT` record `asuid.<host>` holding the
app's `properties.customDomainVerificationId`. Then:

```bash
az containerapp hostname add --subscription "$AZ_SUBSCRIPTION" -g "$AZ_RG" -n "$AZ_APP" --hostname app.example.com
az containerapp hostname bind --subscription "$AZ_SUBSCRIPTION" -g "$AZ_RG" -n "$AZ_APP" --hostname app.example.com \
  --environment "$AZ_ENV" --validation-method CNAME     # issues a free managed certificate
az containerapp update --subscription "$AZ_SUBSCRIPTION" -g "$AZ_RG" -n "$AZ_APP" --set-env-vars WHATBUILD_PUBLIC_URL=https://app.example.com -o none
```

Add `https://app.example.com/auth/microsoft/callback` to the app registration's redirect URIs, and
record the new `WB_PUBLIC_URL`. OAuth metadata, upload grants and links all use it.

### Who can reach it

By default the app is on the internet and WhatBuild's own sign-in guards it, as on Cloud Run. To
admit only some networks, `az containerapp ingress access-restriction set` with an allow rule per
address range. That also shuts out agents that run on a vendor's servers and call `/mcp` from
there; agents on a person's own machine inside the range still connect.

### Private networking

Where policy forbids public endpoints: a virtual network with a subnet delegated to
`Microsoft.App/environments` (a `/27` or larger), the environment created in it
(`az containerapp env create --infrastructure-subnet-resource-id`; this cannot be added later),
and private endpoints with their private DNS zones for the Postgres server
(`privatelink.postgres.database.azure.com`), the storage account's file service
(`privatelink.file.core.windows.net`) and the vault (`privatelink.vaultcore.azure.net`), after
which public access on each is turned off. The app's own ingress can stay external, or the
environment can be created `--internal-only` and reached through the organization's network. The
database statements of step 4 then run from inside the network: a one-off Container Apps job on
the `postgres` image, given the admin password as a vault secret.

### More than one replica, or none idle

`maxReplicas: 1` matches Cloud Run's cap and is ample for a few teams; the image is stateless and
the share is common, so more is a number. With none idle, the app is stopped about five minutes
after its last request, and the next one waits some twenty seconds: most of it for a replica to
be scheduled, a few seconds to pull the image, under one for the server to listen.
`minReplicas: 1` removes that wait and bills a replica all month; a deploy keeps whichever is
set.

## What it costs

Rough figures for 2026; check the pricing calculator for the region. The Postgres server is the
floor: about US$17 a month for `Standard_B1ms` with 32 GiB, running all month. The Basic registry
is about US$5. The app scales to nothing and its monthly free grant covers a few people working in
bursts; a replica kept running all month is roughly US$25 idle and US$80 busy. The vault, the
share, and the logs of one small app are cents.

## What is where

| Thing | Where | Notes |
|---|---|---|
| Names and IDs | `.env.azure` in the operator's clone | gitignored; never a secret |
| Secrets | Key Vault: `whatbuild-database-url`, `whatbuild-grant-key`, `whatbuild-postgres-admin-password`, `whatbuild-postgres-password`, optional `whatbuild-smtp-url`, `whatbuild-microsoft-client-secret` | the app and the job read the first two (and the optional ones) by managed identity |
| The storage account's key | the environment's storage definition | Container Apps keeps it; rotating the key means `az containerapp env storage set` again |
| Files | share `whatbuild-files`, under `<tenant>/…`, each with a `.meta.json` beside it | the filesystem adapter's layout |
| Logs | workspace `log-whatbuild`, `az containerapp logs show` | structured request logs; no content, no tokens |
| Database backups | the server's own, 14 days, point-in-time | `az postgres flexible-server restore` |

## Removing it

Deleting the resource group destroys the database and every file, with no way back once the
server's backups go with it. Export what should be kept first
([§9.4](../spec/09-data-lifecycle.md)), and have the person confirm the group's name.

```bash
az group delete --subscription "$AZ_SUBSCRIPTION" -n "$AZ_RG"
az keyvault purge --subscription "$AZ_SUBSCRIPTION" -n "$AZ_KEYVAULT"   # or its name stays taken for 90 days
az ad app delete --id "$WB_MICROSOFT_CLIENT_ID"                          # with the identity directory active
```
