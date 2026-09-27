#!/usr/bin/env python3
"""Structural check for the okf/ bundle.

Fails (exit 1) on: missing or malformed frontmatter, unknown concept type,
bad status, a malformed `generated` line, a broken link to a file inside
okf/, or a concept no index links to.  Warns (exit 0) on: links out of the
bundle that do not resolve.

    python3 okf/tools/validate_okf.py
"""
import re
import sys
from pathlib import Path

OKF = Path(__file__).resolve().parent.parent
REPO = OKF.parent

TYPES = {
    "Index", "Bundle Guide", "Ontology", "Charter", "Decision",
    "Process", "Tooling", "Domain Concept", "System Concept", "Specification", "Roadmap",
}
STATUSES = {"stable", "draft", "deprecated"}
REQUIRED = ("type", "title", "description", "tags", "generated", "status")

errors, warnings = [], []
LINK = re.compile(r"\[[^\]]*\]\(([^)#]+)(?:#[^)]*)?\)")
GENERATED = re.compile(r"\{\s*by:\s*\S+,\s*at:\s*(\d{4}-\d{2}-\d{2})")


def frontmatter(text):
    """Minimal YAML front-matter reader: top-level scalars only."""
    if not text.startswith("---\n"):
        return None
    end = text.find("\n---", 3)
    if end == -1:
        return None
    meta = {}
    for line in text[4:end].split("\n"):
        if line[:1] in (" ", "-", "") or ":" not in line:
            continue
        key, _, value = line.partition(":")
        meta[key.strip()] = value.strip().strip("\"'")
    return meta


docs = sorted(p for p in OKF.rglob("*.md"))
linked = set()
generated_at = {}

for path in docs:
    rel = path.relative_to(REPO)
    text = path.read_text(encoding="utf-8")
    meta = frontmatter(text)
    if meta is None:
        errors.append(f"{rel}: no YAML frontmatter")
        continue

    for key in REQUIRED:
        if not meta.get(key):
            errors.append(f"{rel}: frontmatter is missing '{key}'")
    if meta.get("type") and meta["type"] not in TYPES:
        errors.append(f"{rel}: unknown type '{meta['type']}' (see okf/ontology.md)")
    if meta.get("status") and meta["status"] not in STATUSES:
        errors.append(f"{rel}: status must be one of {sorted(STATUSES)}")
    if meta.get("generated"):
        m = GENERATED.match(meta["generated"])
        if not m:
            errors.append(f"{rel}: 'generated' must look like {{by: agent:<name>, at: <ISO date>}}")
        else:
            generated_at[path] = m.group(1)

    body = text[text.find("\n---", 3) + 4:]
    for target in LINK.findall(body):
        if target.startswith(("http://", "https://", "mailto:")):
            continue
        dest = (path.parent / target).resolve()
        inside = OKF in dest.parents or dest == OKF
        if not dest.exists():
            (errors if inside else warnings).append(f"{rel}: broken link -> {target}")
        elif inside and dest.suffix == ".md":
            linked.add(dest)

for path in docs:
    if path.name == "index.md" or path.parent == OKF:
        continue
    if path not in linked:
        errors.append(f"{path.relative_to(REPO)}: no index links to it")

for w in warnings:
    print(f"warning: {w}")
for e in errors:
    print(f"ERROR:   {e}")

print(f"\n{len(docs)} concepts checked, {len(errors)} errors, {len(warnings)} warnings.")
sys.exit(1 if errors else 0)
