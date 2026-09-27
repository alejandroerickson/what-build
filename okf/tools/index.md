---
type: Tooling
title: Bundle tools
description: The validator and how to run it.
tags: [tools, okf]
generated: {by: agent:claude, at: 2026-09-26T00:00:00Z}
status: stable
---

# Tools

- `validate_okf.py`: `python3 okf/tools/validate_okf.py`. Fails on missing or malformed
  frontmatter, an unknown `type`, a bad `status`, a broken link inside the bundle, or a concept no
  index links to. Warns on links out of the bundle that do not resolve.
