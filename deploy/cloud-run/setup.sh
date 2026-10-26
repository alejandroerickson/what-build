#!/usr/bin/env bash
# One-time setup of WhatBuild on Google Cloud Run. Run it from a clone, signed in to gcloud.
#
#   PROJECT_ID=my-whatbuild-project deploy/cloud-run/setup.sh
#
# It creates, checking before each step so a re-run is safe:
#   - the image repository in Artifact Registry, keeping recent images only;
#   - a private bucket for files and parsed text, versioned, old versions kept 30 days;
#   - the runtime identity whatbuild-runtime, allowed that bucket and the secrets, nothing else;
#   - secrets in Secret Manager: the database URL and the grant-signing key (and, if you pass them,
#     SMTP and Google sign-in settings). No credential is written to the repository or printed;
#   - a database: Cloud SQL for PostgreSQL when CLOUD_SQL=1, otherwise the DATABASE_URL you pass
#     (any Postgres 15+, e.g. a Neon free-tier database);
#   - the first image (built by Cloud Build — no local Docker needed), the migration job, and the
#     service itself, public on the internet with WhatBuild's own sign-in in front of everything;
#   - log exclusions, so Cloud Run's own request log keeps no address with a query or an
#     invitation in it (the service logs those masked), and no line for a request refused unread;
#   - alerts on server errors, error lines, memory, failed jobs, and floods of requests, data
#     sent out and logs, mailed to one address
#     (deploy/cloud-run/alerts.mjs);
#   - with TRACES_PROJECT, the service's traces, sent to that project and no other.
#
# Settings (environment):
#   PROJECT_ID          required. Deliberately not taken from gcloud's current project.
#   REGION              default northamerica-northeast2
#   SERVICE             default whatbuild
#   CLOUD_SQL=1         create a Cloud SQL instance (about US$10/month for the smallest) instead of
#   DATABASE_URL        …using this connection string for an existing Postgres
#   PUBLIC_URL          the app's public origin if you map a domain (e.g. https://app.what-build.com);
#                       default: the service's run.app URL
#   SITE_URL            the public site's origin (e.g. https://what-build.com), served by the same
#                       service on that host; optional
#   SIGNUP_ALLOWLIST    comma-separated emails or @domains allowed to create accounts; default: the
#                       gcloud account running this script. Invited people can always join.
#   INSTANCE_OWNERS     comma-separated emails of the people who run this instance: they create any
#                       number of organizations and decide who else may; default: the gcloud
#                       account running this script
#   TENANT_ALLOWANCE    how many organizations any other address may create (optional; default 0)
#   SMTP_URL            smtp(s)://user:pass@host:port for sign-in links and invitations (optional)
#   MAIL_FROM           e.g. "WhatBuild <hello@what-build.com>"
#   FEEDBACK_EMAIL      the address that gets the daily digest of people's and agents' feedback
#                       (optional; needs SMTP_URL). Without it, feedback stays in the database.
#   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET   an OAuth web client for "Continue with Google" (optional).
#                       The secret may instead be created in Secret Manager as
#                       whatbuild-google-client-secret, and only GOOGLE_CLIENT_ID passed.
#   SIGNED_URLS=1       also hand agents direct-to-bucket upload URLs for files over 25 MB
#   MAX_INSTANCES       the most instances that run at once, default 1; each one kept busy all month
#                       costs roughly US$62 in northamerica-northeast2, so this is also the
#                       ceiling on the service's instance time
#   NEW_ORGANIZATION_PLAN   free or unlimited: the plan of an organization someone other than an
#                       instance owner creates (optional; unlimited when left out). A deployment
#                       open to the public sets free; one for an organization's own people leaves
#                       it out.
#   EXAMPLE_TENANT      the slug of the example organization every account reads (optional, and
#                       for the maintainer's public deployment only: a self-hosted deployment leaves
#                       it out). The organization must exist: create it in the app, then re-run.
#   ALERT_EMAIL         where alerts go; default: the gcloud account running this script
#   TRACES_PROJECT      a project of its own for the service's traces, made and billed beforehand
#                       (optional; okf/operations/cloud-run.md, Traces). Never PROJECT_ID: a project
#                       with trace storage also keeps Cloud Run's own request spans, whole addresses
#                       and all.
set -euo pipefail

: "${PROJECT_ID:?Set PROJECT_ID to the Google Cloud project for WhatBuild (it is never taken from the current gcloud project).}"
REGION="${REGION:-northamerica-northeast2}"
SERVICE="${SERVICE:-whatbuild}"
REPO="${REPO:-whatbuild}"
JOB="${JOB:-whatbuild-migrate}"
BUCKET="${BUCKET:-$PROJECT_ID-whatbuild-files}"
SQL_INSTANCE="${SQL_INSTANCE:-whatbuild-db}"
RUNTIME_SA="whatbuild-runtime@$PROJECT_ID.iam.gserviceaccount.com"
IMAGE="$REGION-docker.pkg.dev/$PROJECT_ID/$REPO/whatbuild:setup-$(date +%Y%m%d%H%M%S)"
G="gcloud --project $PROJECT_ID --quiet"

step() { printf '\n== %s\n' "$*"; }
secret() { # secret NAME VALUE — create or add a version, reading the value from stdin so it never hits argv
  local name="$1"
  if $G secrets describe "$name" >/dev/null 2>&1; then
    printf '%s' "$2" | $G secrets versions add "$name" --data-file=- >/dev/null
  else
    printf '%s' "$2" | $G secrets create "$name" --replication-policy=automatic --data-file=- >/dev/null
  fi
  $G secrets add-iam-policy-binding "$name" --member "serviceAccount:$RUNTIME_SA" --role roles/secretmanager.secretAccessor >/dev/null
}

if [ -z "${CLOUD_SQL:-}" ] && [ -z "${DATABASE_URL:-}" ]; then
  echo "Choose a database: CLOUD_SQL=1 to create one, or DATABASE_URL=postgres://… for an existing Postgres." >&2
  exit 1
fi

step "Services"
$G services enable run.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com \
  secretmanager.googleapis.com storage.googleapis.com iam.googleapis.com monitoring.googleapis.com ${CLOUD_SQL:+sqladmin.googleapis.com}

step "Image repository $REPO"
if ! $G artifacts repositories describe "$REPO" --location "$REGION" >/dev/null 2>&1; then
  $G artifacts repositories create "$REPO" --location "$REGION" --repository-format docker --description "WhatBuild images"
fi
policy="$(mktemp)"
cat >"$policy" <<'JSON'
[
  {"name": "keep-recent", "action": {"type": "Keep"}, "mostRecentVersions": {"keepCount": 10}},
  {"name": "delete-old", "action": {"type": "Delete"}, "condition": {"tagState": "any", "olderThan": "30d"}}
]
JSON
$G artifacts repositories set-cleanup-policies "$REPO" --location "$REGION" --policy "$policy" --no-dry-run >/dev/null
rm -f "$policy"

step "Runtime identity"
if ! $G iam service-accounts describe "$RUNTIME_SA" >/dev/null 2>&1; then
  $G iam service-accounts create whatbuild-runtime --display-name "WhatBuild service and jobs"
fi
PROJECT_NUMBER="$($G projects describe "$PROJECT_ID" --format='value(projectNumber)')"
BUILD_SA="${BUILD_SA:-$PROJECT_NUMBER-compute@developer.gserviceaccount.com}"
$G iam service-accounts add-iam-policy-binding "$RUNTIME_SA" --member "serviceAccount:$BUILD_SA" --role roles/iam.serviceAccountUser >/dev/null
for role in run.admin artifactregistry.writer logging.logWriter; do
  $G projects add-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:$BUILD_SA" --role "roles/$role" --condition None >/dev/null
done
# Builds read their uploaded source from this bucket (gcloud creates it on first use; make it now).
SOURCE_BUCKET="${PROJECT_ID}_cloudbuild"
$G storage buckets describe "gs://$SOURCE_BUCKET" >/dev/null 2>&1 ||
  $G storage buckets create "gs://$SOURCE_BUCKET" --location us --uniform-bucket-level-access --public-access-prevention
$G storage buckets add-iam-policy-binding "gs://$SOURCE_BUCKET" --member "serviceAccount:$BUILD_SA" --role roles/storage.objectViewer >/dev/null
# Google gives the default compute identity Editor on the whole project, which would let anything
# acting as it start machines. Builds need only the roles above, so take it away.
if [ "$BUILD_SA" = "$PROJECT_NUMBER-compute@developer.gserviceaccount.com" ]; then
  $G projects remove-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:$BUILD_SA" --role roles/editor --condition None >/dev/null 2>&1 || true
fi

step "Bucket gs://$BUCKET"
if ! $G storage buckets describe "gs://$BUCKET" >/dev/null 2>&1; then
  $G storage buckets create "gs://$BUCKET" --location "$REGION" --uniform-bucket-level-access --public-access-prevention
fi
# Files are create-only, so versions only ever hold deleted bytes: keep them 30 days, then let them go.
$G storage buckets update "gs://$BUCKET" --versioning >/dev/null
lifecycle="$(mktemp)"
echo '{"rule": [{"action": {"type": "Delete"}, "condition": {"isLive": false, "daysSinceNoncurrentTime": 30}}]}' >"$lifecycle"
$G storage buckets update "gs://$BUCKET" --lifecycle-file "$lifecycle" >/dev/null
rm -f "$lifecycle"
$G storage buckets add-iam-policy-binding "gs://$BUCKET" --member "serviceAccount:$RUNTIME_SA" --role roles/storage.objectAdmin >/dev/null
if [ -n "${SIGNED_URLS:-}" ]; then
  # Signing a URL without a key file calls signBlob as the runtime identity itself.
  $G iam service-accounts add-iam-policy-binding "$RUNTIME_SA" --member "serviceAccount:$RUNTIME_SA" --role roles/iam.serviceAccountTokenCreator >/dev/null
fi

CLOUDSQL_FLAGS=()
if [ -n "${CLOUD_SQL:-}" ]; then
  step "Cloud SQL instance $SQL_INSTANCE (this takes several minutes the first time)"
  if ! $G sql instances describe "$SQL_INSTANCE" >/dev/null 2>&1; then
    $G sql instances create "$SQL_INSTANCE" --database-version POSTGRES_17 --edition ENTERPRISE --tier db-f1-micro \
      --region "$REGION" --storage-auto-increase --backup-start-time 07:00 --retained-backups-count 7 --enable-point-in-time-recovery
  fi
  $G sql databases describe whatbuild --instance "$SQL_INSTANCE" >/dev/null 2>&1 || $G sql databases create whatbuild --instance "$SQL_INSTANCE"
  if ! $G secrets describe whatbuild-database-url >/dev/null 2>&1; then
    DB_PASSWORD="$(openssl rand -base64 30 | tr -d '/+=' | cut -c1-32)"
    $G sql users create whatbuild --instance "$SQL_INSTANCE" --password "$DB_PASSWORD" >/dev/null 2>&1 ||
      $G sql users set-password whatbuild --instance "$SQL_INSTANCE" --password "$DB_PASSWORD" >/dev/null
    CONN="$PROJECT_ID:$REGION:$SQL_INSTANCE"
    secret whatbuild-database-url "postgres://whatbuild:$DB_PASSWORD@/whatbuild?host=/cloudsql/$CONN"
    unset DB_PASSWORD
  else
    $G secrets add-iam-policy-binding whatbuild-database-url --member "serviceAccount:$RUNTIME_SA" --role roles/secretmanager.secretAccessor >/dev/null
  fi
  $G projects add-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:$RUNTIME_SA" --role roles/cloudsql.client --condition None >/dev/null
  CLOUDSQL_FLAGS=(--set-cloudsql-instances "$PROJECT_ID:$REGION:$SQL_INSTANCE")
else
  step "Database URL secret"
  secret whatbuild-database-url "$DATABASE_URL"
fi

step "Secrets"
$G secrets describe whatbuild-grant-key >/dev/null 2>&1 || secret whatbuild-grant-key "$(openssl rand -base64 48)"
$G secrets add-iam-policy-binding whatbuild-grant-key --member "serviceAccount:$RUNTIME_SA" --role roles/secretmanager.secretAccessor >/dev/null
SECRETS="DATABASE_URL=whatbuild-database-url:latest,WHATBUILD_GRANT_KEY=whatbuild-grant-key:latest"
if [ -n "${SMTP_URL:-}" ]; then secret whatbuild-smtp-url "$SMTP_URL"; fi
if [ -n "${GOOGLE_CLIENT_SECRET:-}" ]; then secret whatbuild-google-client-secret "$GOOGLE_CLIENT_SECRET"; fi
# Each of these may also be created by hand in Secret Manager, and the service uses it whenever it
# exists. The edge key always is, once the Cloudflare Worker is in front and has it
# (okf/operations/cloud-run.md, A custom domain).
for pair in WHATBUILD_SMTP_URL=whatbuild-smtp-url WHATBUILD_GOOGLE_CLIENT_SECRET=whatbuild-google-client-secret WHATBUILD_EDGE_KEY=whatbuild-edge-key; do
  if $G secrets describe "${pair#*=}" >/dev/null 2>&1; then
    $G secrets add-iam-policy-binding "${pair#*=}" --member "serviceAccount:$RUNTIME_SA" --role roles/secretmanager.secretAccessor >/dev/null
    SECRETS="$SECRETS,$pair:latest"
  fi
done

step "First image (Cloud Build)"
$G builds submit --region "$REGION" --tag "$IMAGE" .

ALLOW="${SIGNUP_ALLOWLIST:-$(gcloud config get-value account 2>/dev/null)}"
OWNERS="${INSTANCE_OWNERS:-$(gcloud config get-value account 2>/dev/null)}"
ENV_VARS="WHATBUILD_GCS_BUCKET=$BUCKET,WHATBUILD_SIGNUP_ALLOWLIST=${ALLOW//,/;},WHATBUILD_INSTANCE_OWNERS=${OWNERS//,/;}"
[ -n "${TENANT_ALLOWANCE:-}" ] && ENV_VARS="$ENV_VARS,WHATBUILD_TENANT_ALLOWANCE=$TENANT_ALLOWANCE"
[ -n "${MAIL_FROM:-}" ] && ENV_VARS="$ENV_VARS,WHATBUILD_MAIL_FROM=$MAIL_FROM"
[ -n "${FEEDBACK_EMAIL:-}" ] && ENV_VARS="$ENV_VARS,WHATBUILD_FEEDBACK_EMAIL=$FEEDBACK_EMAIL"
[ -n "${GOOGLE_CLIENT_ID:-}" ] && ENV_VARS="$ENV_VARS,WHATBUILD_GOOGLE_CLIENT_ID=$GOOGLE_CLIENT_ID"
[ -n "${SIGNED_URLS:-}" ] && ENV_VARS="$ENV_VARS,WHATBUILD_GCS_SIGNED_URLS=1"
[ -n "${NEW_ORGANIZATION_PLAN:-}" ] && ENV_VARS="$ENV_VARS,WHATBUILD_NEW_ORGANIZATION_PLAN=$NEW_ORGANIZATION_PLAN"
[ -n "${EXAMPLE_TENANT:-}" ] && ENV_VARS="$ENV_VARS,WHATBUILD_EXAMPLE_TENANT=$EXAMPLE_TENANT"
[ -n "${SITE_URL:-}" ] && ENV_VARS="$ENV_VARS,WHATBUILD_SITE_URL=$SITE_URL"
if [ -n "${TRACES_PROJECT:-}" ]; then
  step "Traces, in $TRACES_PROJECT"
  if [ "$TRACES_PROJECT" = "$PROJECT_ID" ]; then
    echo "TRACES_PROJECT must be another project than PROJECT_ID (okf/operations/cloud-run.md, Traces)." >&2
    exit 1
  fi
  $G services enable telemetry.googleapis.com
  gcloud --project "$TRACES_PROJECT" --quiet services enable telemetry.googleapis.com cloudtrace.googleapis.com observability.googleapis.com bigquery.googleapis.com
  gcloud --project "$TRACES_PROJECT" --quiet projects add-iam-policy-binding "$TRACES_PROJECT" --member "serviceAccount:$RUNTIME_SA" \
    --role roles/telemetry.tracesWriter --condition None >/dev/null
  ENV_VARS="$ENV_VARS,OTEL_EXPORTER_OTLP_ENDPOINT=https://telemetry.googleapis.com,OTEL_RESOURCE_ATTRIBUTES=gcp.project_id=$TRACES_PROJECT"
fi
# A list inside a --set-env-vars value needs gcloud's alternate delimiter syntax. The delimiter is "|",
# which no email, domain or sender name contains ("@" would split the allowlist).
ENV_ARG="^|^${ENV_VARS//,/|}"
ENV_ARG="${ENV_ARG//;/,}"

step "Migration job $JOB"
if $G run jobs describe "$JOB" --region "$REGION" >/dev/null 2>&1; then
  $G run jobs update "$JOB" --region "$REGION" --image "$IMAGE" --set-secrets "$SECRETS" ${CLOUDSQL_FLAGS[@]+"${CLOUDSQL_FLAGS[@]}"}
else
  $G run jobs create "$JOB" --region "$REGION" --image "$IMAGE" --service-account "$RUNTIME_SA" \
    --command node --args main.js,migrate --set-secrets "$SECRETS" ${CLOUDSQL_FLAGS[@]+"${CLOUDSQL_FLAGS[@]}"} \
    --max-retries 0 --task-timeout 600
fi
$G run jobs execute "$JOB" --region "$REGION" --wait

step "Service $SERVICE"
# CPU stays allocated so the in-process worker parses uploads after the response returns;
# with min-instances 0 an idle service still scales to nothing and costs nothing. Public again with
# each run (--allow-unauthenticated): a service the kill switch closed is opened by it.
$G run deploy "$SERVICE" --region "$REGION" --image "$IMAGE" --service-account "$RUNTIME_SA" \
  --allow-unauthenticated --no-cpu-throttling --min-instances 0 --max-instances "${MAX_INSTANCES:-1}" --memory 1Gi --cpu 1 \
  --concurrency 40 --timeout 300 --set-secrets "$SECRETS" --set-env-vars "$ENV_ARG" ${CLOUDSQL_FLAGS[@]+"${CLOUDSQL_FLAGS[@]}"}
# The stable run.app address, named by project number (status.url is the older, hashed one).
URL="${PUBLIC_URL:-https://$SERVICE-$PROJECT_NUMBER.$REGION.run.app}"
$G run services update "$SERVICE" --region "$REGION" --update-env-vars "WHATBUILD_PUBLIC_URL=$URL" >/dev/null

step "Request logs without addresses that carry words or credentials"
# Cloud Run logs every request itself, with its whole address: a search's words, a sign-in link's
# token, an invitation link. The service logs its own line for each, with those masked, so the
# platform's line is dropped for any address with a query or an invitation in it.
LOG_FILTER="log_id(\"run.googleapis.com/requests\") AND resource.labels.service_name=\"$SERVICE\" AND (httpRequest.requestUrl:\"?\" OR httpRequest.requestUrl:\"/invite/\" OR httpRequest.requestUrl:\"/join/\")"
if $G logging sinks describe _Default --format='value(exclusions[].name)' | tr ';' '\n' | grep -qx "$SERVICE-request-addresses"; then verb=--update-exclusion; else verb=--add-exclusion; fi
$G logging sinks update _Default "$verb=name=$SERVICE-request-addresses,filter=$LOG_FILTER" >/dev/null

step "Request logs without the requests refused unread"
# A request without the edge key is refused (403) before the service runs anything, its log line
# included, and Cloud Run itself refuses (429) what the instances cannot take. The platform's line
# for each is dropped too, so a flood sent straight to the run.app address writes no logs to pay
# for. The request metrics still count every one, and the service keeps its own line for each 403
# it gives someone it served.
REFUSED_FILTER="log_id(\"run.googleapis.com/requests\") AND resource.labels.service_name=\"$SERVICE\" AND (httpRequest.status=403 OR httpRequest.status=429)"
if $G logging sinks describe _Default --format='value(exclusions[].name)' | tr ';' '\n' | grep -qx "$SERVICE-refused-requests"; then verb=--update-exclusion; else verb=--add-exclusion; fi
$G logging sinks update _Default "$verb=name=$SERVICE-refused-requests,filter=$REFUSED_FILTER" >/dev/null

step "Alerts"
# With the kill switch (kill-switch.sh), its topic, so its alerts stay as they are.
KILL_TOPIC=""
$G pubsub topics describe "$SERVICE-kill-switch" >/dev/null 2>&1 && KILL_TOPIC="projects/$PROJECT_ID/topics/$SERVICE-kill-switch"
if command -v node >/dev/null 2>&1; then
  PROJECT_ID="$PROJECT_ID" SERVICE="$SERVICE" ALERT_EMAIL="${ALERT_EMAIL:-}" KILL_SWITCH_TOPIC="$KILL_TOPIC" node deploy/cloud-run/alerts.mjs
else
  echo "Node is not installed here, so no alerts were made. Where it is: PROJECT_ID=$PROJECT_ID node deploy/cloud-run/alerts.mjs"
fi

cat <<EOF

WhatBuild is deployed at $URL

Next:
  1. Continuous deployment: Cloud Build > Triggers > Connect repository (GitHub), then a trigger on
     release tags with configuration file /deploy/cloud-run/cloudbuild.yaml and substitution
     _REGION=$REGION.
     Pick the trigger's region once, before connecting; it runs builds for this service.
     Until the trigger exists, a push to main deploys nothing; deploy by hand with gcloud builds
     submit (see okf/operations/cloud-run.md).
  2. Sign-in: without SMTP_URL or GOOGLE_CLIENT_ID there is no way to sign in yet. For Google, create
     an OAuth web client with redirect URI $URL/auth/google/callback and re-run with
     GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET. For email links, re-run with SMTP_URL and MAIL_FROM.
  3. Only $ALLOW (and anyone invited) can create an account. Change SIGNUP_ALLOWLIST to widen it.
     Only $OWNERS can create organizations, and lets others at $URL/instance.
  4. Connect an agent: $URL/connect
EOF
