# Security policy

## Reporting a vulnerability

Report it privately: on this repository's **Security** tab, choose **Report a vulnerability**.
Please do not open a public issue or pull request for it. Say what you found, how to reproduce it,
and what it exposes.

This covers the code in this repository and the hosted service at `app.what-build.com`. A
self-hosted deployment is run by its operator; report a problem in the code here, and a problem in
someone's deployment to them.

## Supported versions

The latest [release](https://github.com/alejandroerickson/what-build/releases). A fix ships in a new
release; the release notes say what it fixes once it is safe to say.

## How the repository is checked

What the app defends against, and where, is in the [threat model](../okf/system/security.md). The
checks that keep secrets out of the repository and find known vulnerabilities in its dependencies,
workflows and running app are in [security checks](../okf/operations/security-checks.md).
