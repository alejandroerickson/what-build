---
type: Process
title: A deployment's capacity is measured with a stepped load test on a dev deployment, signed in as synthetic people, never on production.
description: For the agent measuring what a deployment can take; what a load test answers, matching dev to production, sizing the test against the database's month and the spending cap, the synthetic people it signs in as, running each kind of traffic in steps, watching the instance and the database, reading where it breaks, trying a larger database pool, scaling out, and cleaning up.
tags: [operations, load-test, capacity, dev, cloud-run, neon, k6]
generated: {by: agent:claude, at: 2026-11-25}
status: draft
---

# Load testing

A load test says how much traffic one instance of the service takes before people wait, what gives
out first, and what more instances, a larger database or a different setting would change. It runs
on a [dev deployment](dev-deployment.md), laid out like production, and never on production
([decision](../decisions/capacity-is-load-tested-on-a-dev-deployment-signed-in-as-synthetic-people.md)):
a test meant to find where things break would break them for real people, run up the bill, and use
the database's month.

The tools are [k6](https://grafana.com/docs/k6/latest/set-up/install-k6/), installed on its own
(`brew install k6`) and not one of the repository's dependencies,
[`scripts/load-test/load.js`](../../scripts/load-test/load.js), the test, and
[`scripts/load-test/accounts.mjs`](../../scripts/load-test/accounts.mjs), the synthetic people it
signs in as. The numbers a test gives belong to the deployment it measured: keep them with that
deployment's own notes, never in this repository.

## What it answers

- **Requests a second for each kind of traffic**, before the median and the 95th percentile climb
  and before requests fail: the public site, the sign-in page, someone reading a product in the
  web app, a guest doing the same, and an agent's MCP calls. Then a mix of them.
- **What gives out first**: the instance's CPU or memory, its concurrent requests, its database
  connections, or the database's compute.
- **Scaling**: when Cloud Run starts another instance, how long an instance takes to start, and
  what the maximum instances mean in people.
- **The pool**: how far a larger `WHATBUILD_DATABASE_POOL_SIZE` moves what one instance serves.
- **The database**: the compute size the load needs, the connections it holds, and the compute
  hours an hour of it uses.

## Before it runs

**Match dev to production.** Compare the two services and the two databases, and make dev's match
for the test, writing down each value you change so you can put it back:

```bash
for p in $PP $P; do gcloud run services describe whatbuild --project $p --region $R --format=json | python3 -c '
import sys, json; d = json.load(sys.stdin); t = d["spec"]["template"]; a = t["metadata"]["annotations"]
print(d["status"]["latestReadyRevisionName"], "concurrency", t["spec"].get("containerConcurrency"), t["spec"]["containers"][0]["resources"]["limits"],
      "min", a.get("autoscaling.knative.dev/minScale", 0), "max", a.get("autoscaling.knative.dev/maxScale"), "cpu-throttling", a.get("run.googleapis.com/cpu-throttling"))'; done
for n in $NP $N; do neon api /projects/$n/endpoints | python3 -c '
import sys, json; [print(e["id"], e["branch_id"], e["autoscaling_limit_min_cu"], "to", e["autoscaling_limit_max_cu"], "CU") for e in json.load(sys.stdin)["endpoints"]]'; done
```

`P`, `R` and `N` are dev's project, region and Neon project ([its values](dev-deployment.md#its-values));
`PP` and `NP` are production's. A dev compute fixed at a smaller size than production's range is
changed for the test with `neon api /projects/$N/endpoints/<id> -X PATCH -d '{"endpoint":{"autoscaling_limit_min_cu":<min>,"autoscaling_limit_max_cu":<max>}}'`,
which restarts the compute in a few seconds. Differences that stay, such as dev having no Worker in
front, are accounted for when reading the result (below).

**Size it against the database's month.** A plan with monthly allowances, such as Neon's free plan
(compute hours, and 5 GB of network transfer a project), suspends the compute until the month ends
once either is used. Read dev's usage so far, and keep the test far inside what is left:

```bash
neon projects get $N -o json | python3 -c '
import sys, json; p = json.load(sys.stdin); p = p.get("project", p)
print(round(p["compute_time_seconds"] / 3600, 2), "CU-hours,", round(p["data_transfer_bytes"] / 1e9, 2), "GB sent, since", p["consumption_period_start"])'
```

A test's compute is its minutes times the compute's size: half an hour at 0.25 to 1 CU is at most
half a CU-hour. What the database sends per request is small; the transfer that adds up is a
dump or a copy of the whole database. The figures Neon reports lag by some minutes.

**Stay far from the spending cap.** Dev's spending counts towards the billing account's cap
([a hard limit on the bill](cloud-run.md#a-hard-limit-on-the-bill)). The kill switch logs the
month's spending each time the budget writes:

```bash
gcloud logging read 'resource.labels.service_name="whatbuild-kill-switch" AND textPayload:"cap"' --project $PP --freshness 1d --limit 1 --format='value(timestamp,textPayload)'
```

A test's own cost is small: the instance's minutes, and data sent to the internet (the test
machine's responses). The flood alerts read only the project they are in, so a test on dev trips
them only if production's metrics scope takes in dev's project.

## The people it signs in as

A dev deployment's only sign-in is a real identity provider's, so a load test signs in with
sessions and access tokens made in its database for synthetic people at `example.com`. They read
the example organization, which every account reads, and write nothing there. What the test makes
of its own goes in an organization of its own. A dev deployment holds the instance owners'
organizations: never write into them.

```bash
umask 077; L=$(mktemp -d)
node scripts/load-test/accounts.mjs $L --base $DEV_URL           # 199 members, 25 guests, 80 agents by default
DB="$(gcloud secrets versions access latest --secret whatbuild-database-url --project $P)&sslrootcert=system"
psql "$DB" -v ON_ERROR_STOP=1 -q -f $L/setup.sql
```

- **Members** are admins of the organization `load-test-synthetic` and guests of the example
  organization, so their reads take the same path a guest's do, but for coming in.
- **Guests** are accounts in no organization. Each comes in only while a guest's place is free
  (Instance admin → Guests, *Guests in at once*, 25 by default): more guests than places wait.
- **Agents** hold access tokens to `/mcp` at the viewer level.
- **Every person** may make the guests' *Calls a minute, each guest* in the example organization
  (120 by default) before the server answers `429 rate_limited`. Spread a step over enough people: a step
  of *n* requests a second needs more than *n* ÷ 2 of them at the default.

For [live streams](cloud-run.md#live-updates), make a product in the synthetic organization as its
owner (`O` is `owner` in `tokens.json`); a guest of the example organization holds no stream:

```bash
O=$(python3 -c 'import json, sys; print(json.load(open(sys.argv[1]))["owner"])' $L/tokens.json)
curl -s -X POST -H "Cookie: __Host-wb_session=$O" -H "Origin: $DEV_URL" -H 'Sec-Fetch-Site: same-origin' \
  -H 'Content-Type: application/json' -d '{"name":"Load test product","slug":"load-test"}' \
  $DEV_URL/api/v1/tenants/load-test-synthetic/products
```

## Running it

One kind of traffic at a time, then the mix, each in steps of a constant rate (45 seconds is
enough to settle), with a minute between runs. The test stops itself at the first step past
`MAX_P95_MS` (4000 by default) or `MAX_FAILED` (a tenth), and prints a line a step: the rate asked
for and served, the latency at the 50th to 99th percentiles, failures, `429`s, `5xx`s, other
`4xx`s, and requests k6 could not start in time (`drop`, a sign the service was holding them):

```bash
X=(k6 run -q -e BASE=$DEV_URL -e TOKENS=$L/tokens.json -e PRODUCT=<example organization>/<product> -e STEP=45)
"${X[@]}" -e SCENARIO=reader -e RATES=5,10,20,30,40,60,80 scripts/load-test/load.js
"${X[@]}" -e SCENARIO=guest  -e RATES=5,10,20,30,40      scripts/load-test/load.js
"${X[@]}" -e SCENARIO=mcp    -e RATES=10,20,30,40,60,80  scripts/load-test/load.js
"${X[@]}" -e SCENARIO=signin -e RATES=25,50,100,200,300,500 scripts/load-test/load.js
"${X[@]}" -e SCENARIO=site   -e RATES=25,50,100,200      scripts/load-test/load.js
"${X[@]}" -e SCENARIO=mix    -e RATES=10,20,30,40,50,60  scripts/load-test/load.js
"${X[@]}" -e SCENARIO=mix    -e RATES=10,20,30,40,50 -e STREAMS=25 -e STREAM_PRODUCT=load-test-synthetic/load-test scripts/load-test/load.js
```

`PRODUCT` is a product with sources and Story pages that every synthetic person reads: the example
organization's, where there is one. Latency is as the test machine sees it, its own round trip to
the service included; measure that round trip first on one kept-alive connection to `/health`,
which reads no database:

```bash
a=(); for i in $(seq 10); do a+=("$DEV_URL/health" -o /dev/null); done; curl -s -w '%{time_starttransfer}\n' "${a[@]}"
```

The mix weighs the kinds of traffic by `MIX` (`signin:2,reader:4,guest:1,mcp:3` by default); set
it to the shares expected. Behind the [Cloudflare Worker](cloud-run.md#setting-it-up) the public
site and the app's scripts and styles are served at the edge, so the service never sees them: a
dev deployment without the Worker serves them itself, and the `site` scenario measures that, not
what production's service carries. One step a little past the breaking point, briefly, with
`MAX_P95_MS` and `MAX_FAILED` raised, shows what people meet when it is overloaded.

## Watching it

**The instance**, a minute at a time from Cloud Monitoring; the last minute shows a few minutes
late. Run it for each metric in turn: `container/cpu/utilizations` and
`container/memory/utilizations` (`ALIGN_PERCENTILE_99`), `container/instance_count` (`ALIGN_MAX`),
`container/max_request_concurrencies` (`ALIGN_PERCENTILE_99`), `request_count` (`ALIGN_RATE`) and
`request_latencies` (`ALIGN_PERCENTILE_95`, the service's own time):

```bash
m=container/cpu/utilizations; a=ALIGN_PERCENTILE_99
curl -s -G -H "Authorization: Bearer $(gcloud auth print-access-token)" "https://monitoring.googleapis.com/v3/projects/$P/timeSeries" \
  --data-urlencode "filter=metric.type=\"run.googleapis.com/$m\" AND resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"whatbuild\"" \
  --data-urlencode "interval.startTime=<start, UTC>" --data-urlencode "interval.endTime=<end, UTC>" \
  --data-urlencode aggregation.alignmentPeriod=60s --data-urlencode aggregation.perSeriesAligner=$a --data-urlencode aggregation.crossSeriesReducer=REDUCE_MAX |
  python3 -c 'import sys, json; [print(p["interval"]["endTime"][11:16], p["value"]) for s in json.load(sys.stdin).get("timeSeries", []) for p in s["points"]]'
```

**The database**, every few seconds while the test runs: the service's connections by state, and
what the busy ones wait on.

```bash
while sleep 5; do psql "$DB" -AtF' ' -c "select to_char(now(), 'HH24:MI:SS'), count(*) filter (where state = 'active'),
  count(*) filter (where state like 'idle in%'), count(*), string_agg(distinct wait_event, ',') filter (where state = 'active')
  from pg_stat_activity where datname = current_database() and usename = current_user and pid <> pg_backend_pid()"; done
```

**Where a request's time goes**, from a deployment's [traces](cloud-run.md#traces): how many
statements each kind of request runs, and how long one statement takes, which on a database in
another region is mostly the round trip. A dev deployment without traces can read production's,
which run the same code:

```bash
bq query --project_id $T --use_legacy_sql=false '
  with s as (select trace_id, count(*) n from `'$T'.whatbuild_traces._AllSpans` where start_time > timestamp_sub(current_timestamp(), interval 3 day) and kind = 3 group by trace_id)
  select r.name, count(*) requests, round(avg(coalesce(s.n, 0)), 1) statements, round(avg(r.duration_nano) / 1e6) ms
  from `'$T'.whatbuild_traces._AllSpans` r left join s using (trace_id)
  where r.start_time > timestamp_sub(current_timestamp(), interval 3 day) and r.kind = 2 group by r.name order by requests desc limit 20'
```

`kind = 3` alone, grouped by `name`, gives each statement's duration; `BEGIN` and `COMMIT`, which
do nothing, are the round trip itself.

## Reading it

Find the step where the median or the 95th percentile first rises well past the steps before, and
say which of these explains it:

- **The database connections.** Each instance holds at most `WHATBUILD_DATABASE_POOL_SIZE`, 10
  unless the deployment sets it ([the database's connections](cloud-run.md#the-databases-connections)).
  A request runs its statements one after another, each one round trip, and holds a connection for
  each, for a whole transaction at a time. So an instance serves at most about the pool ÷
  (statements per request × one round trip) such requests a second, whatever its CPU. Signs: CPU
  well under half, the service's connections all open but almost none `active` in Postgres, latency
  doubling within one step and no failures until Cloud Run refuses. A database further away lowers
  the ceiling in proportion, and a larger pool raises it until another of these limits comes first
  ([A larger pool](#a-larger-pool)).
- **The instance's concurrent requests** (`--concurrency`): an open live stream holds one for as
  long as it lasts (at most `WHATBUILD_LIVE_MAX_STREAMS` of them), and requests waiting for a
  database connection hold theirs too. Past it, with no instance left to start, Cloud Run holds
  requests a while, then answers `429`. Cloud Run's log line for a `429` is dropped
  (`whatbuild-refused-requests`); the request metrics count it.
- **CPU**: one Node process on the instance's CPU. Signs: utilization near its limit while the
  database's connections wait. Requests that read no database (the sign-in page, `/api/v1/meta`)
  find this limit.
- **Memory**: reads take little; a file being parsed takes much more
  ([Parsing](cloud-run.md#setting-it-up)), so uploads during a busy hour share the instance with it.
- **The database's compute**: busy `active` connections, waits on CPU or I/O, and the compute
  scaling to its top size.
- **Limits that refuse on purpose**: guests' places (guests wait), each person's calls a minute
  (`429 rate_limited` in the body), `database_busy` after a request waited 15 seconds for a
  connection.

Then turn requests a second into people. A person working in the web app asks a few requests of
the service for each screen; an agent makes a call every few seconds while it works. Say the rate
per person assumed beside each figure.

**Scaling out.** With the maximum instances at one, Cloud Run starts no other, give or take a
deploy or a sudden spike. To see what more would do, raise dev's for one run
(`gcloud run services update whatbuild --project $P --region $R --max-instances <n>`, a new
revision), run the mix past one instance's limit, and read when each instance started and how long
it took to listen:

```bash
gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="whatbuild" AND (textPayload:"Starting new instance" OR textPayload:"listening on")' \
  --project $P --freshness 1h --order=asc --format='value(timestamp,labels.instanceId,textPayload)'
```

Each instance holds its own pool, so the database's connection limit bounds how many may run
([the database's connections](cloud-run.md#the-databases-connections)). A first request after the
database has suspended also waits for it to start: time one after it has been idle past its
suspend timeout.

## A larger pool

When the connections are what gives out first, try a larger `WHATBUILD_DATABASE_POOL_SIZE` on dev
before production takes it. The service must run an image that reads the setting (a release or a
commit of `main` from after it was added; an older image ignores it), and dev's compute must be
sized as production's for the test, since Neon's connection limit follows the compute's size:

```bash
psql "$DB" -Atc 'show max_connections'     # the most the pool, times the instances, and every other client may hold
gcloud run services describe whatbuild --project $P --region $R --format=json | python3 -c '
import sys, json; e = json.load(sys.stdin)["spec"]["template"]["spec"]["containers"][0].get("env", [])
print([v for v in e if v["name"] == "WHATBUILD_DATABASE_POOL_SIZE"] or "the default, 10")'
```

1. Run the mix at the default first, the same day, as the baseline to compare with.
2. Set the size, a new revision with the same image, and wait for it to serve:
   `gcloud run services update whatbuild --project $P --region $R --update-env-vars WHATBUILD_DATABASE_POOL_SIZE=<n>`.
   Two sizes tell more than one: twice and four times the default, say.
3. Run the same mix, with `RATES` going past the baseline's knee, and the stream run too, while
   watching the database's connections and the instance's CPU and concurrency ([Watching it](#watching-it)).
4. Read where the knee moved. It moves up with the pool while the connections are the limit: all
   of them open at the knee, few `active`, CPU still well under its limit. It stops moving where
   the CPU nears its limit, where requests in flight reach `--concurrency` less the open streams,
   or where the database's connections turn `active` with waits on CPU or I/O and its compute
   scales up. The size past which the knee no longer moves is the most that helps; a deployment
   takes no more than that, and no more than its database allows for every instance and client
   ([the database's connections](cloud-run.md#the-databases-connections)).

## Afterwards

1. Delete the synthetic organization through the app's API as its owner, with what the deletion
   asks, then remove the people:

   ```bash
   curl -s -X DELETE -H "Cookie: __Host-wb_session=$O" -H "Origin: $DEV_URL" -H 'Sec-Fetch-Site: same-origin' -H 'Content-Type: application/json' \
     -d '{"reason":"Synthetic organization of a load test","confirm":"delete permanently","name":"Load test (synthetic)"}' \
     $DEV_URL/api/v1/tenants/load-test-synthetic
   psql "$DB" -v ON_ERROR_STOP=1 -q -f $L/teardown.sql
   ```

2. The server's usage counts for the day include the test. Where nobody else used the deployment
   that day, take them out: `delete from usage_people where day = '<day>'; delete from usage_calls where day = '<day>'`.
3. Put back every setting changed for the test: the maximum instances and the pool's size (a new
   revision with the same image; `--remove-env-vars WHATBUILD_DATABASE_POOL_SIZE` where dev had
   none), the database compute's limits.
4. Check: no account at `load-test-%@example.com`, no organization `load-test-synthetic`, no jobs
   waiting, the service's settings as before. `rm -r $L`.
