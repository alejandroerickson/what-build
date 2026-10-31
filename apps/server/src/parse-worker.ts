// The entry of the worker thread that parses one file (parse-child.ts starts it, in the process of
// its own that file has). It receives the bytes, parses them with the pure parsers into the text a
// derivation stores, hands its buffer to that process without a copy, and ends. It imports nothing
// of the server, and Node loads it as it is, stripping its types, so it keeps to syntax that erases.
import { parentPort, workerData } from "node:worker_threads";
import { derive, toParsedFile } from "@whatbuild/parsers";

const job = workerData as { bytes: Uint8Array; fileName: string; mediaType: string | null; parseCapBytes: number };
const parsed = toParsedFile(await derive(job.bytes, job.fileName, { mediaType: job.mediaType, parseCapBytes: job.parseCapBytes }));
parentPort!.postMessage(parsed, [parsed.text_md.buffer as ArrayBuffer]);
