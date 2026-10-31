// Stands in for the server, in a process of its own for a test to kill: it starts one parse, in a
// real child process, whose thread never finishes, and says so.
import { processParser } from "../../src/parse-process.ts";

const parser = processParser({ memoryMb: 64, timeoutSeconds: 120 }, { thread: new URL("./thread.ts", import.meta.url) });
void parser.parse(new TextEncoder().encode("x"), "spins.txt", { mediaType: null, parseCapBytes: 1024 });
console.log("parsing");
setInterval(() => undefined, 60_000);
