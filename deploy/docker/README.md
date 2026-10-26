# The end-to-end instance on a Docker host

`compose.yaml`, `whatbuild-e2e.sh` and `env.example` serve the end-to-end golden master with a
release's image on any machine that runs Docker, reset before each run and following releases.
How to set it up and use it: [`okf/operations/end-to-end-on-a-docker-host.md`](../../okf/operations/end-to-end-on-a-docker-host.md).

It runs the image as a development server, where anyone signs in as anyone, on real people's
data: it answers on the host's loopback only, and the host is your own.
