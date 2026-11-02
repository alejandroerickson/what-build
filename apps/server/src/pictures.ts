import { PICTURE_GRANT_PURPOSE, PICTURE_ROUTE, type Env } from "@whatbuild/core";
import { Hono } from "hono";

/** What a picture's address asks of a browser: to keep it, private to this one, for as long as the address works. */
const headers = (seconds: number) => ({
  "Content-Type": "image/webp",
  "Cache-Control": `private, max-age=${seconds}, immutable`,
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "sandbox; default-src 'none'",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Referrer-Policy": "no-referrer",
});

/**
 * The route that serves attachments' pictures: `GET /api/v1/pictures/<grant>`. The grant is the only
 * authority. It is signed for one copy of one picture, made by WhatBuild from an attachment, and
 * names nobody; the route reads no cookie and no database, so it counts no call and none of anyone's
 * day, and a page of a list costs one call however many pictures it shows. A deleted source's
 * pictures are gone once the job that releases its bytes has run.
 */
export function pictureRoutes(env: Env) {
  const app = new Hono();
  app.get(`${PICTURE_ROUTE}/:grant`, async (c) => {
    const claims = env.ports.grants.verify(c.req.param("grant"));
    const key = claims?.["k"];
    if (!claims || claims["purpose"] !== PICTURE_GRANT_PURPOSE || typeof key !== "string" || !/^t\/[^/]+\/r\/[^/]+\/p\/[^/]+\/(thumb|preview)\.webp$/.test(key))
      return c.text("This picture's address has expired or was not given by WhatBuild.", 401);
    const stat = await env.ports.blobs.stat(key);
    if (!stat) return c.text("There is no such picture.", 404);
    const left = Math.max(0, Number(claims["exp"]) - Math.floor(Date.now() / 1000));
    return c.body(await env.ports.blobs.getStream(key), 200, { ...headers(left), "Content-Length": String(stat.size) });
  });
  return app;
}
