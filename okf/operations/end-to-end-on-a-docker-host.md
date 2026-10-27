---
type: System Concept
title: The end-to-end instance on a Docker host, serving each release's image on a fresh copy of the golden master
description: An always-on end-to-end instance on any machine that runs Docker, such as a home server or a NAS; the release image as a development server, its Postgres, loading a golden master exported from a checkout, resetting before each run, following releases, and running the plans against it through an SSH tunnel.
tags: [operations, testing, e2e, docker, golden-master, releases]
generated: {by: agent:claude, at: 2026-10-27}
status: draft
---

# The end-to-end instance on a Docker host

The [end-to-end tests](end-to-end-tests.md) run on `pnpm dev:e2e`, which serves the checkout's
source through Vite. The same golden master can also be served by **the release image**, on any
machine that runs Docker and stays on, such as a NAS. A plan run there tests what a deployment
actually runs: the built server and web app, the image's Node, a Postgres server of its own, and
the migrations a release brings, taken as a deployment takes them. The agent that runs the plans
stays where it is; only the address it tests changes.

It is not a deployment for people. It runs the image as a **development server**
(`NODE_ENV=development`), because the test tools sign in through the development sign-in, where
anyone signs in as anyone; mail only prints. So it answers on the host's loopback only and is
reached through an SSH tunnel. It holds real people's data, as the golden master does
([a copy of production](a-copy-of-production.md)), and like every copy outside production only
organizations an instance owner owns ([decision](../decisions/copies-outside-production-hold-only-organizations-an-instance-owner-owns.md)): the host must be the maintainer's own, and
its folder is never shared or backed up anywhere public.

## The pieces

Everything is in [`deploy/docker/`](../../deploy/docker/):

| File | What it is |
|---|---|
| `compose.yaml` | Postgres 17, the app (`<image>:<tag>`, on `127.0.0.1:<port>`, offering the plans in the example file the image carries, `/app/plans.example.json`, as local development does), and an optional updater. |
| `whatbuild-e2e.sh` | `load`, `reset`, `update`, `nightly`, `status`, run on the host. |
| `env.example` | The settings, copied to `.env` beside them on the host, where it stays. |

On the host, the folder holds those three files, `.env`, and `data/`: `data/pg` (the cluster),
`data/golden` (the export: `database.dump`, `files/`, `golden.json`) and `data/blobs` (the served
copy's files). The cluster holds two databases: `golden`, loaded from the export and never served,
and `e2e`, a template copy of it that the app serves and that `reset` makes again. The
application's role (`whatbuild`) owns both and is not a superuser, so row-level security holds as
on a deployment.

## Setting it up

1. On the host, make a folder for it and put `compose.yaml`, `whatbuild-e2e.sh` and `env.example`
   in it. Copy `env.example` to `.env` and fill it in: the folder's absolute path, the image and
   repository, a password (`openssl rand -hex 24`), the port, and the tunnel's address.
2. Where Docker needs root, as on a NAS whose socket only root may open, give the SSH user a sudo
   rule for this script alone, without a password, so an agent can reset over SSH and nothing
   else: `<user> ALL=(root) NOPASSWD: <folder>/whatbuild-e2e.sh` in a file under `/etc/sudoers.d/`
   (mode `440`), and run it as `sudo <folder>/whatbuild-e2e.sh …`. Check the file with
   `visudo -c -f <file>` before it goes there, on another machine if the host has no `visudo`: a
   rule sudo cannot parse turns sudo off. Make the folder and the script root's, writable by root
   alone (the folder `700`, since `.env` and `data/` are in it), or the rule gives root to whoever
   can edit them. The script finds `docker` in `/usr/local/bin`, which sudo's PATH leaves out.
3. If the image is private, sign root in to the registry with a token that only reads packages:
   `sudo docker login ghcr.io -u <user>`. The login is kept in `/root/.docker`, which the updater
   mounts. Keep that token out of `.env`.
4. In the checkout, export the golden master and copy it into a folder of the SSH user's own on the
   host, which only that user reads (the script's folder is root's):

   ```sh
   corepack pnpm e2e export                                  # .what-build/e2e/export/<built>/
   ssh <host> 'mkdir -m 700 incoming'
   COPYFILE_DISABLE=1 tar -C .what-build/e2e/export/<built> -cf - . | ssh <host> 'tar -C incoming -xf -'
   ```

   `rsync -a` does as well where the host allows it; a NAS may refuse rsync over SSH. On macOS,
   `COPYFILE_DISABLE=1` keeps tar from adding `._` files, which would land among the files.
5. On the host: `sudo <folder>/whatbuild-e2e.sh load ~/incoming`, with the export's absolute path,
   since the script works in its own folder. It takes the export into `data/golden`, makes the role
   and the `golden` database, restores the dump as the role, takes the newest release if `.env`
   names none, and resets. It refuses an export whose `golden.json` does not say
   `"owned_by_instance_owners": true`: one of a golden master built before pulls checked who owns
   each organization. Then delete `~/incoming`: it is real people's data.
6. To follow releases, start the updater from the folder, as root where Docker needs it:
   `docker compose --profile updater up -d updater`. Name the service, or compose recreates the app
   without the example organization, which only the script reads from `golden.json`. Each night it
   runs `whatbuild-e2e.sh nightly`, which takes a newer release if there is one, on a fresh copy,
   and logs to `update.log`.

A new golden master (after `pnpm e2e golden` from a newer pull or
[dataset](the-non-production-dataset.md)) goes the same way: export, copy, `load`.

## What `reset` does

It is what `pnpm dev:e2e` does before serving, and what each run starts from:

1. stops the app, drops `e2e` and makes it again from `golden`;
2. copies `data/golden/files` into `data/blobs`, owned by the image's user;
3. runs the image's migrations (`node main.js migrate`), so a release's migrations run on the copy
   as they would on a deployment taking it, and a failed migration stops the reset;
4. starts the app and waits for `/health`.

The export already gives the development sign-in's people their roles (Riley, Sam and Jordan in the
example and the standard organization; the synthetic organization's own people in theirs), which
`pnpm dev:e2e` gives each time it serves. The example organization is the one `golden.json` names.

`update [tag]` takes a release (the newest by default), records it in `.env` as `WHATBUILD_TAG`,
pulls the image and resets. `status` says which release is served and which golden master, with
its organizations and every product's path, and warns when that golden master was built before
pulls checked who owns each organization: load a new export.
`logs [lines]` prints the app's log and the updater's, which the sudo rule lets an agent read.

## Running the plans against it

From the checkout, open a tunnel and point the tools at its end:

```sh
ssh -N -L 5293:127.0.0.1:5283 <host> &                     # the port in .env, to a free local one
ssh <host> 'sudo <folder>/whatbuild-e2e.sh reset'          # a fresh copy for this plan (sudo where Docker needs root)
WHATBUILD_E2E_URL=http://localhost:5293 corepack pnpm e2e run smoke
WHATBUILD_E2E_URL=http://localhost:5293 corepack pnpm e2e browser signin sam
```

`WHATBUILD_E2E_PUBLIC_URL` in `.env` must be the tunnel's local end, since the app writes its own
address into sign-in redirects and links. Choose a local port that nothing listens on, on IPv6 as
on IPv4 (`lsof -nP -iTCP:<port> -sTCP:LISTEN`): ssh forwards from whichever of `::1` and
`127.0.0.1` it can take, and `localhost` may reach another server on the other. Forward to
`127.0.0.1` on the host, where the app is published, not to `localhost`, which may try `::1`.

The SSH user must be allowed to forward. A NAS may forbid it to everyone but its administrator
(`AllowTcpForwarding no`); the tunnel then connects and each request through it is reset. Allow
this user to forward to the app's port and nowhere else, at the end of `sshd_config`, checked with
`sshd -t` before sshd reloads:

```
Match User <user>
	AllowTcpForwarding local
	PermitOpen 127.0.0.1:<port>
```

A NAS may write its `sshd_config` and `/etc/sudoers.d/` again when its system is updated or its SSH
settings change; after either, check that the tunnel and `sudo -n <folder>/whatbuild-e2e.sh
status` still work.

Reset between plans as `pnpm e2e stop` and `pnpm dev:e2e` do locally. The run's folder, log and
report stay in the checkout, as for a local run. The `run-end-to-end-tests` skill runs a plan here
when asked to test a release or on the Docker host. It finds the host in the checkout's `.env` (the
main checkout's, from a worktree): `E2E_HOST`, the SSH host; `E2E_HOST_DIR`, the script's folder
there; `E2E_HOST_PORT`, the app's port on the host; and `E2E_TUNNEL_PORT`, the tunnel's local end,
which the host's `.env` names in `WHATBUILD_E2E_PUBLIC_URL`.

To try sign-up, admission and the instance owner's screens at size here, add the
[synthetic people](local-development.md#many-people) through the tunnel:
`corepack pnpm people --url http://localhost:<tunnel port>`. Riley Chen is the instance's owner, as
`compose.yaml` sets. They stay until the next `reset`, `update` or nightly update, and adding them
again after one makes the same people. The host has no allowlist (`compose.yaml` sets none), so it lets
anyone sign up; admission as a stranger meets it is tried with `pnpm dev:people`.

A release brings a new image, which the updater takes; a change to `deploy/docker/` itself
(`compose.yaml`, `whatbuild-e2e.sh`) is copied to the host's folder by whoever has root there.

## What differs from a local run

- The code is a release's, not the checkout's: a change not yet released is tested locally. The
  app names that release (the account menu, the feedback dialog), where `pnpm dev:e2e` says it is
  a development server.
- The server log is `whatbuild-e2e.sh logs` on the host (under sudo where Docker needs root).
- The image serves the built web app itself, on one port, where `pnpm dev:e2e` has Vite in front of
  the API; the development sign-in is offered the same way, since the server says whether it is.
