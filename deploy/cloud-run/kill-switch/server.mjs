// The kill switch's HTTP server: Pub/Sub pushes each message from its topic here (kill-switch.mjs).
// A failure to close answers 500, so Pub/Sub tries again; anything else is acknowledged.
import { createServer } from "node:http";
import { handle, metadataToken, parseServices } from "./kill-switch.mjs";

const services = parseServices(process.env.SERVICES);
const log = (entry) => console.log(JSON.stringify(entry));

createServer(async (req, res) => {
  if (req.method !== "POST") return res.writeHead(405).end();
  let text = "";
  for await (const chunk of req) {
    text += chunk;
    if (text.length > 65536) return res.writeHead(413).end();
  }
  let push;
  try {
    push = JSON.parse(text);
  } catch {
    log({ severity: "WARNING", message: "a push that is not JSON, dropped" });
    return res.writeHead(204).end();
  }
  try {
    await handle(push, { services, token: () => metadataToken(), log });
    res.writeHead(204).end();
  } catch (e) {
    log({ severity: "ERROR", message: `the kill switch could not close every service: ${e instanceof Error ? e.message : e}` });
    res.writeHead(500).end();
  }
}).listen(Number(process.env.PORT ?? 8080));
