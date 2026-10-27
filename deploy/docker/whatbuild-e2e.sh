#!/bin/sh
# WhatBuild's end-to-end instance on a Docker host (okf/operations/end-to-end-on-a-docker-host.md).
# Run on the host, from the folder holding this script, compose.yaml and .env.
#
#   whatbuild-e2e.sh load <export>   take a golden master `pnpm e2e export` made, from its folder on the host,
#                                    then reset
#   whatbuild-e2e.sh reset           serve a fresh copy of the golden master: what each run starts from
#   whatbuild-e2e.sh update [tag]    serve a release (the newest by default) on a fresh copy
#   whatbuild-e2e.sh nightly         update only when a newer release is out (the updater runs this)
#   whatbuild-e2e.sh status          the release served, the golden master, and whether it answers
#   whatbuild-e2e.sh logs [lines]    the app's last lines of log (200 by default), and the updater's
#
# The golden master is the database `golden`, never served; the app serves `e2e`, a template copy of
# it, with its files copied from data/golden/files. Both are real people's data.
set -eu
# Where Docker needs root, this runs under sudo, whose PATH leaves out /usr/local/bin, where a NAS
# may keep docker.
PATH=$PATH:/usr/local/bin
here=$(cd "$(dirname "$0")" && pwd)
cd "$here"
[ -f .env ] || { echo "No .env here: copy env.example to .env and fill it in." >&2; exit 1; }
set -a
. ./.env
set +a
golden_json="$WHATBUILD_E2E_DIR/data/golden/golden.json"
field() { [ -f "$golden_json" ] && sed -n "s/.*\"$1\": \"\([^\"]*\)\".*/\1/p" "$golden_json" | head -n 1 || true; }
# The example organization is the one the golden master names; the server reads it at start-up.
WHATBUILD_EXAMPLE_TENANT=$(field example)
export WHATBUILD_EXAMPLE_TENANT
compose() { docker compose --env-file .env "$@"; }
psql_admin() { compose exec -T postgres psql -v ON_ERROR_STOP=1 -U postgres -d "${2:-postgres}" -c "$1"; }
now() { date -u +%FT%TZ; }

set_tag() {
  if grep -q '^WHATBUILD_TAG=' .env; then
    sed -i.bak "s/^WHATBUILD_TAG=.*/WHATBUILD_TAG=$1/" .env && rm -f .env.bak
  else
    echo "WHATBUILD_TAG=$1" >> .env
  fi
  WHATBUILD_TAG=$1
  export WHATBUILD_TAG
}

newest_release() {
  { wget -qO- "https://api.github.com/repos/$WHATBUILD_REPO/releases/latest" 2>/dev/null \
    || curl -fsS "https://api.github.com/repos/$WHATBUILD_REPO/releases/latest"; } \
    | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -n 1
}

# compose.yaml names the image by its tag, so the first command takes the newest release.
ensure_tag() {
  [ -n "${WHATBUILD_TAG:-}" ] && return 0
  tag=$(newest_release)
  [ -n "$tag" ] || { echo "Could not read the newest release of $WHATBUILD_REPO." >&2; exit 1; }
  set_tag "$tag"
  compose pull -q whatbuild
}

reset() {
  ensure_tag
  [ -f "$golden_json" ] || { echo "No golden master: copy an export here and run whatbuild-e2e.sh load." >&2; exit 1; }
  compose up -d --wait postgres
  compose stop whatbuild >/dev/null 2>&1 || true
  psql_admin "drop database if exists e2e with (force)"
  psql_admin "create database e2e template golden owner whatbuild"
  # The files, as the image's user (node) owns them.
  compose run --rm --no-deps --user root --entrypoint sh whatbuild -c \
    'find /data/blobs -mindepth 1 -delete && cp -a /golden/files/. /data/blobs/ && chown -R node:node /data/blobs'
  # Migrations newer than the golden master, as on any deployment taking a release.
  compose run --rm --no-deps whatbuild node --enable-source-maps main.js migrate
  compose up -d whatbuild
  for _ in $(seq 1 60); do
    if compose exec -T whatbuild node -e "fetch('http://localhost:8080/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))" 2>/dev/null; then
      echo "$(now) serving ${WHATBUILD_IMAGE}:${WHATBUILD_TAG} on a fresh copy of the golden master built $(field built_at)"
      return 0
    fi
    sleep 2
  done
  echo "$(now) the app did not answer; see: docker compose logs whatbuild" >&2
  exit 1
}

load() {
  src=${1:?usage: whatbuild-e2e.sh load <folder pnpm e2e export made>}
  [ -f "$src/database.dump" ] && [ -f "$src/golden.json" ] || { echo "$src holds no export (database.dump, golden.json, files/)." >&2; exit 1; }
  # A copy outside production holds only organizations an instance owner owns; an export from before
  # pulls checked owners may hold another.
  grep -q '"owned_by_instance_owners": true' "$src/golden.json" || {
    echo "$src is from a golden master built before pulls checked who owns each organization: export a new one (pnpm fixture pull, pnpm e2e golden, pnpm e2e export)." >&2; exit 1; }
  dest="$WHATBUILD_E2E_DIR/data/golden"
  if [ "$(cd "$src" && pwd)" != "$dest" ]; then
    rm -rf "$dest.new" && mkdir -p "$dest.new"
    cp -a "$src/." "$dest.new/"
    rm -rf "$dest" && mv "$dest.new" "$dest"
  fi
  mkdir -p "$WHATBUILD_E2E_DIR/data/pg" "$WHATBUILD_E2E_DIR/data/blobs"
  ensure_tag
  compose up -d --wait postgres
  compose stop whatbuild >/dev/null 2>&1 || true
  psql_admin "do \$\$ begin
    if not exists (select from pg_roles where rolname = 'whatbuild') then
      create role whatbuild login nosuperuser nobypassrls createdb password '$WHATBUILD_E2E_PG_PASSWORD';
    end if; end \$\$"
  psql_admin "drop database if exists e2e with (force)"
  psql_admin "drop database if exists golden with (force)"
  psql_admin "create database golden owner whatbuild"
  psql_admin "create extension pg_trgm" golden
  # As the application's role, which then owns every table, so row-level security holds as on a
  # deployment; the extension's comment and the statistics need a superuser and are left out.
  compose exec -T postgres sh -c "pg_restore --list /golden/database.dump | grep -v -e 'COMMENT - EXTENSION' -e 'STATISTICS DATA' > /tmp/restore.list && \
    PGPASSWORD='$WHATBUILD_E2E_PG_PASSWORD' pg_restore -h localhost -U whatbuild -d golden --no-owner --no-privileges --exit-on-error --use-list=/tmp/restore.list /golden/database.dump"
  echo "$(now) loaded the golden master built $(field built_at) from the pull $(field pull), schema at $(field migration)"
  reset
}

update() {
  tag=${1:-$(newest_release)}
  [ -n "$tag" ] || { echo "Could not read the newest release of $WHATBUILD_REPO." >&2; exit 1; }
  set_tag "$tag"
  compose pull -q whatbuild
  reset
  docker image prune -f >/dev/null
}

case "${1:-}" in
  load) load "${2:-}" ;;
  reset) reset ;;
  update) update "${2:-}" ;;
  nightly)
    tag=$(newest_release)
    if [ -z "$tag" ]; then echo "$(now) could not read the newest release" >&2; exit 1; fi
    if [ "$tag" = "${WHATBUILD_TAG:-}" ]; then echo "$(now) up to date at $tag"; else update "$tag"; fi
    ;;
  status)
    echo "release   ${WHATBUILD_TAG:-none}"
    echo "golden    built $(field built_at) from the pull $(field pull), schema at $(field migration), commit $(field commit)"
    echo "example   ${WHATBUILD_EXAMPLE_TENANT:-?}; standard $(field standard); synthetic $(field synthetic)"
    # Every product's path, as pnpm e2e run prints them from a checkout's own golden master.
    if [ -f "$golden_json" ]; then
      sed -n '/"products"/,/]/s/^ *"\([^"]*\)",\{0,1\}$/product   \1/p' "$golden_json"
      grep -q '"owned_by_instance_owners": true' "$golden_json" ||
        echo "warning   this golden master was built before pulls checked who owns each organization: load a new export"
    fi
    compose ps
    ;;
  logs)
    compose logs --no-color --tail "${2:-200}" whatbuild
    if [ -f update.log ]; then echo "--- update.log"; tail -n 20 update.log; fi
    ;;
  *) sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
