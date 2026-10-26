#!/usr/bin/env bash
# The kill switch for a Cloud Run deployment of WhatBuild: a hard limit on the Google Cloud bill.
# Run it from a clone, signed in to gcloud as someone who administers the project and its billing
# account. A re-run is safe, and is how the cap or the services change:
#
#   PROJECT_ID=my-whatbuild CAP=250 deploy/cloud-run/kill-switch.sh
#
# When the month's spending on the billing account reaches CAP, in the account's currency, or when
# a flood runs away (the two kill switch policies of alerts.mjs), the service in
# deploy/cloud-run/kill-switch/ takes the public off the invoker role of every service in SERVICES:
# closed to the internet, with its data and settings kept. okf/operations/cloud-run.md, A hard limit
# on the bill, says how to open them again.
#
# It creates, or brings up to date:
#   - the identity whatbuild-kill-switch, allowed to change who may call those services (a role of
#     two permissions, whatbuildKillSwitch, in each of their projects) and to call itself;
#   - the Pub/Sub topic whatbuild-kill-switch, which the budget and those alerts publish to;
#   - the service whatbuild-kill-switch, built by Cloud Build, private and reachable from inside
#     the project only, and the push subscription that calls it;
#   - the budget "WhatBuild: every project" on the billing account, of CAP a month, mailed to the
#     account's billing administrators at 75%, 100%, 200% and 500% and when the forecast passes it;
#   - the alerts (alerts.mjs), with the two that trip the kill switch.
#
# Settings (environment):
#   PROJECT_ID       required: the project the kill switch lives in, the service's own.
#   CAP              required: the most a month may cost, a whole amount in the billing account's
#                    currency. Every project billed to the account counts.
#   REGION           default northamerica-northeast2
#   SERVICE          default whatbuild
#   SERVICES         what to close, project/region/service, comma-separated; default the service in
#                    PROJECT_ID. Name every deployment billed to the same account, the dev one too.
#   BILLING_ACCOUNT  default: PROJECT_ID's
#   ALERT_EMAIL      where alerts go; default: the gcloud account running this
set -euo pipefail

: "${PROJECT_ID:?Set PROJECT_ID to the Google Cloud project for WhatBuild (it is never taken from the current gcloud project).}"
: "${CAP:?Set CAP to the most a month may cost, a whole amount in the currency of the billing account, such as 100.}"
[[ "$CAP" =~ ^[1-9][0-9]*$ ]] || { echo "CAP must be a whole amount, such as 100." >&2; exit 1; }
REGION="${REGION:-northamerica-northeast2}"
SERVICE="${SERVICE:-whatbuild}"
SERVICES="${SERVICES:-$PROJECT_ID/$REGION/$SERVICE}"
SERVICES="${SERVICES// /}"
NAME="$SERVICE-kill-switch"
SA="$NAME@$PROJECT_ID.iam.gserviceaccount.com"
TOPIC="projects/$PROJECT_ID/topics/$NAME"
IMAGE="$REGION-docker.pkg.dev/$PROJECT_ID/${REPO:-whatbuild}/$NAME:$(date +%Y%m%d%H%M%S)"
BUDGET="WhatBuild: every project"
G="gcloud --project $PROJECT_ID --quiet"

step() { printf '\n== %s\n' "$*"; }
# A new identity takes a moment to be known to IAM everywhere, so a grant to it is tried again.
retry() { local i; for i in 1 2 3 4 5 6; do "$@" 2>/dev/null && return 0; sleep 10; done; "$@"; }

PROJECT_NUMBER="$($G projects describe "$PROJECT_ID" --format='value(projectNumber)')"
BILLING_ACCOUNT="${BILLING_ACCOUNT:-$($G billing projects describe "$PROJECT_ID" --format='value(billingAccountName)' | sed 's#billingAccounts/##')}"
CURRENCY="$(gcloud billing accounts describe "$BILLING_ACCOUNT" --format='value(currencyCode)')"

step "APIs"
$G services enable run.googleapis.com pubsub.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  billingbudgets.googleapis.com monitoring.googleapis.com

step "Identity $SA"
$G iam service-accounts describe "$SA" >/dev/null 2>&1 || $G iam service-accounts create "$NAME" --display-name "WhatBuild kill switch" >/dev/null

step "Its right to close $SERVICES"
# Only who may call each service: changing its ingress or its revision would also need the right to
# act as its runtime identity, which reads the database and the files.
ROLE=whatbuildKillSwitch
PERMISSIONS=run.services.getIamPolicy,run.services.setIamPolicy
IFS=, read -ra TARGETS <<< "$SERVICES"
for p in $(printf '%s\n' "${TARGETS[@]}" | cut -d/ -f1 | sort -u); do
  if gcloud iam roles describe "$ROLE" --project "$p" >/dev/null 2>&1; then
    gcloud iam roles update "$ROLE" --project "$p" --permissions "$PERMISSIONS" --quiet >/dev/null
  else
    gcloud iam roles create "$ROLE" --project "$p" --title "WhatBuild kill switch" --stage GA \
      --description "Take the public off a Cloud Run service's invoker role" --permissions "$PERMISSIONS" --quiet >/dev/null
  fi
done
for t in "${TARGETS[@]}"; do
  IFS=/ read -r p r s <<< "$t"
  retry gcloud --project "$p" --quiet run services add-iam-policy-binding "$s" --region "$r" \
    --member "serviceAccount:$SA" --role "projects/$p/roles/$ROLE" >/dev/null
done

step "Topic $TOPIC"
$G pubsub topics describe "$NAME" >/dev/null 2>&1 || $G pubsub topics create "$NAME" >/dev/null
$G pubsub topics add-iam-policy-binding "$NAME" --member serviceAccount:billing-budget-alert@system.gserviceaccount.com \
  --role roles/pubsub.publisher >/dev/null

step "Service $NAME"
$G builds submit --region "$REGION" --tag "$IMAGE" deploy/cloud-run/kill-switch
# Internal ingress: only the push subscription, from inside the project, reaches it, and it runs
# only while a message is handled. SERVICES holds commas, so the list takes gcloud's other delimiter.
$G run deploy "$NAME" --region "$REGION" --image "$IMAGE" --service-account "$SA" --no-allow-unauthenticated \
  --ingress internal --min-instances 0 --max-instances 1 --concurrency 1 --memory 256Mi --cpu 1 --timeout 120 \
  --set-env-vars "^|^SERVICES=$SERVICES" >/dev/null
URL="$($G run services describe "$NAME" --region "$REGION" --format='value(status.url)')"
$G run services add-iam-policy-binding "$NAME" --region "$REGION" --member "serviceAccount:$SA" --role roles/run.invoker >/dev/null
# Pub/Sub signs each push with a token of the identity.
$G iam service-accounts add-iam-policy-binding "$SA" --role roles/iam.serviceAccountTokenCreator \
  --member "serviceAccount:service-$PROJECT_NUMBER@gcp-sa-pubsub.iam.gserviceaccount.com" >/dev/null
if $G pubsub subscriptions describe "$NAME" >/dev/null 2>&1; then
  $G pubsub subscriptions update "$NAME" --push-endpoint "$URL" --push-auth-service-account "$SA" >/dev/null
else
  $G pubsub subscriptions create "$NAME" --topic "$NAME" --push-endpoint "$URL" --push-auth-service-account "$SA" \
    --ack-deadline 60 --min-retry-delay 10s --max-retry-delay 600s --message-retention-duration 1d --expiration-period never >/dev/null
fi

step "Budget \"$BUDGET\": $CAP $CURRENCY a month"
B="gcloud billing budgets --billing-project $PROJECT_ID --quiet"
ID="$($B list --billing-account "$BILLING_ACCOUNT" --filter="displayName=\"$BUDGET\"" --format='value(name)' | head -1)"
RULES=(--threshold-rule percent=0.75 --threshold-rule percent=1.0 --threshold-rule percent=2.0 --threshold-rule percent=5.0 --threshold-rule percent=1.0,basis=forecasted-spend)
if [ -n "$ID" ]; then
  $B update "$ID" --billing-account "$BILLING_ACCOUNT" --budget-amount "$CAP$CURRENCY" --notifications-rule-pubsub-topic "$TOPIC" \
    --clear-threshold-rules "${RULES[@]/--threshold-rule/--add-threshold-rule}" >/dev/null
else
  $B create --billing-account "$BILLING_ACCOUNT" --display-name "$BUDGET" --budget-amount "$CAP$CURRENCY" \
    --notifications-rule-pubsub-topic "$TOPIC" "${RULES[@]}" >/dev/null
fi

step "Alerts, with the two that trip the kill switch"
PROJECT_ID="$PROJECT_ID" SERVICE="$SERVICE" ALERT_EMAIL="${ALERT_EMAIL:-}" KILL_SWITCH_TOPIC="$TOPIC" node deploy/cloud-run/alerts.mjs
# Cloud Monitoring publishes as its own agent, which exists once a Pub/Sub channel does.
$G pubsub topics add-iam-policy-binding "$NAME" --role roles/pubsub.publisher \
  --member "serviceAccount:service-$PROJECT_NUMBER@gcp-sa-monitoring-notification.iam.gserviceaccount.com" >/dev/null

cat <<END

The kill switch is on: at $CAP $CURRENCY in a month, or a flood that runs away, it closes
$SERVICES to the internet. What it did is in its log:

  gcloud logging read 'resource.labels.service_name="$NAME"' --project $PROJECT_ID --freshness 1d --limit 20

To open a service again: raise CAP and re-run this, or wait for the next month, then
  gcloud run services add-iam-policy-binding <service> --project <project> --region <region> \\
    --member allUsers --role roles/run.invoker
END
