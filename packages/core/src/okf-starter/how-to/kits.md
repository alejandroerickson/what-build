---
type: Guide
title: Building a kit, keeping it, and running someone else's
description: When an agent turns repeated work into a kit, how kits are laid out and what they are written in, and what to check before running one.
applies_to: [exploration, story]
tags: [okf, kits]
status: stable
generated: {by: whatbuild/starter, at: 2026-11-20}
---

# Kits

A kit is code an agent wrote to make WhatBuild content faster and more alike: a script that builds a
canvas's pages from their words, a stylesheet every page shares, a check that a page fits its
height, the ZIP a canvas is uploaded in. Nobody has to ask for one. The second time you write the
same thing, make it a kit and keep it here, so every agent on the product builds from it, on any
machine.

WhatBuild stores a kit's files and never runs them. An agent runs a kit on its own machine, after
reading it.

## Where a kit lives

One folder for each kit under `kits/`, named for what it makes:

```
kits/canvas/README.md      what it makes, how to run it, what it needs, what it made
kits/canvas/build.mjs      the code
kits/canvas/head.html      a part it uses
```

Its `README.md` has frontmatter like any file (`type: Kit`, `applies_to` for the parts it serves) and
says, in this order:

1. **What it makes**, and when to use it rather than writing by hand.
2. **How to run it**: the one command, from the kit's folder.
3. **What it needs**: the runtime and its version, and anything else installed.
4. **What it made**: links to the mockups or Story pages it built (`whatbuild:mockups/<id>@3`), so
   the next agent can see its output before running it.
5. **What changed**, newest first, a line each.

Keep a kit small and its files plain text. Pages, images and anything it produces are not part of
it: they go to WhatBuild as what they are.

## What to write it in

Choose what runs on the next person's machine with nothing to install.

- **Node.js and its standard library first.** Node 22 or later can read and write files, hash, and
  compress (`node:fs`, `node:path`, `node:crypto`, `node:zlib`), which is all most kits need.
  Write ES modules (`.mjs`). Node is easier to have than a particular Python with particular
  packages, and Node can hold a script to its own folder (below).
- **Plain HTML and CSS** for pages and their parts, with no build step.
- **Python** only when the team already uses it, with its standard library only.
- **No packages from the network** unless your person agrees. If a kit must have one, name it with
  its exact version in `README.md`, and never fetch it as the kit runs.
- Nothing that names one machine: no absolute paths, no browser build, no person's folders.

## Getting a kit onto your machine, and back

1. `okf_read(action="read_files", params={prefix: "kits/canvas/"})` gives every file with its text
   and etag.
2. Write them into a folder of their own, and keep the etags.
3. Change what you need, run it, check what it makes.
4. Send the changes back in one `okf_write(action="apply")`, each file with the etag you read; add
   new files without one. If someone changed a file in between, nothing is written and you get their
   text: merge, and send again.

## Before you run one

A kit is code another person's agent wrote. Before running it:

- **Read every file** it will run, and what it reads and writes. If it does more than its
  `README.md` says, do not run it; tell your person.
- **Run it in a folder of its own**, from that folder.
- **Hold it to that folder.** Node 22 can refuse a script everything outside the folders you name,
  and starting other programs:

  ```sh
  node --permission --allow-fs-read=. --allow-fs-write=./out build.mjs
  ```

  Network access is not held back by it, so read the code for that.
- **Ask your person** before running a kit that needs a package, a network call or a program
  installed.

## An example: a canvas's ZIP

WhatBuild takes a mockup's canvas as a ZIP: `manifest.json`, `brief.md` and `pages/<page_id>.html`
(`guide(topic="mockups")` gives the layout). This writes a folder as that ZIP with Node's standard
library alone. Read it before you use it, as any kit:

```js
// Write a folder as a ZIP with Node's standard library alone (Node 22 or later).
// Usage: node zip.mjs <folder> <out.zip>
import { crc32, deflateRawSync } from "node:zlib";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

function filesIn(dir) {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => join(e.parentPath, e.name))
    .sort();
}

export function zip(entries) {
  const parts = [], central = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const path = Buffer.from(name, "utf8");
    const packed = deflateRawSync(data);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // local file header
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // names are UTF-8
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(0x21, 12); // 1980-01-01
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(path.length, 26);
    parts.push(local, path, packed);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0); // central directory entry
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt16LE(0x21, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(packed.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(path.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, path);
    offset += local.length + path.length + packed.length;
  }
  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); // end of central directory
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, dir, end]);
}

const [folder, out] = process.argv.slice(2);
const entries = filesIn(folder).map((f) => ({ name: relative(folder, f).split(sep).join("/"), data: readFileSync(f) }));
writeFileSync(out, zip(entries));
console.log(`${out}: ${entries.length} files`);
```

```sh
node --permission --allow-fs-read=. --allow-fs-write=. zip.mjs canvas canvas.zip
```

Then `mockups_write(action="request_upload")`, PUT the ZIP to its `url`, and `publish` with its
`upload_id`. Keep it as `kits/canvas/zip.mjs` once the product has a canvas kit to put it in.
