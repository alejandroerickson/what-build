import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Navigate, useNavigate, useParams, useSearchParams } from "react-router";
import { api } from "../lib/api.ts";
import { lastProduct, useMe, useProducts } from "../lib/session.tsx";
import { Button, Callout, ErrorCallout, Loading, TextField } from "../ui/index.tsx";

const DATA_STATEMENT =
  "WhatBuild is a free, pre-1.0 demonstration service. Your content sits in a managed Postgres database and an object store we rent from providers named on our sub-processors page. It is encrypted in transit, encrypted at rest as far as those providers do it, and isolated per organization by the application and by the database. We take no analytics about what you do in the app, show no ads, sell nothing, and train no model on your content — there is no AI in the product to train one with. We do not promise uptime or durability, and we cannot promise anything on behalf of our providers. Export is always available and always complete. Please don't put anything here whose loss or exposure would hurt.";

export function SignIn() {
  const [params] = useSearchParams();
  const next = params.get("next") ?? "/";
  const [email, setEmail] = useState("");
  const methods = useQuery({ queryKey: ["auth-methods"], queryFn: () => api<{ email_link: boolean; google: boolean; dev: boolean }>("GET", "/auth/methods") });
  const me = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const send = useMutation({ mutationFn: () => api<{ sent: boolean; dev_note?: string }>("POST", "/auth/email", { email, next }) });
  const dev = useMutation({
    mutationFn: (e: string) => api("POST", "/auth/dev-sign-in", { email: e, next }),
    onSuccess: async () => {
      await qc.invalidateQueries();
      navigate(next, { replace: true });
    },
  });
  if (me.data) return <Navigate to={next} replace />;
  const error = params.get("error");
  return (
    <div className="center-page stack-lg">
      <div className="stack-sm">
        <h1>Sign in to WhatBuild</h1>
        <p className="muted">We email you a link that signs you in. No password to remember.</p>
      </div>
      {error ? <Callout tone="warning" title="That sign-in did not work">{error === "link_expired" ? "The link expired or was already used. Ask for a new one." : error === "invite_only" ? "WhatBuild is invite-only for now. Ask someone who uses it to invite you." : "Try again, or use the email link."}</Callout> : null}
      {methods.data && !methods.data.email_link ? null : send.isSuccess ? (
        <Callout tone="success" title="Check your email">
          We sent a sign-in link to {email}. It works once, for 15 minutes.{send.data.dev_note ? ` ${send.data.dev_note}` : ""}
        </Callout>
      ) : (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            send.mutate();
          }}
        >
          <TextField label="Email address" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          {send.isError ? <ErrorCallout error={send.error} /> : null}
          <Button type="submit" variant="primary" busy={send.isPending} busyLabel="Sending…">
            Email me a sign-in link
          </Button>
        </form>
      )}
      {methods.data?.google ? (
        <a className="btn btn-secondary btn-md" href={`/auth/google?next=${encodeURIComponent(next)}`}>
          Continue with Google
        </a>
      ) : null}
      {methods.data?.dev ? (
        <section className="card stack-sm" aria-labelledby="dev-signin">
          <h2 id="dev-signin" style={{ fontSize: "var(--text-md)" }}>
            Development sign-in
          </h2>
          <p className="small muted">Only on a development server. The sample data has two people:</p>
          <div className="row">
            <Button size="sm" onClick={() => dev.mutate("riley@example.com")}>Riley Chen (owner)</Button>
            <Button size="sm" onClick={() => dev.mutate("sam@example.com")}>Sam Okafor (editor)</Button>
            <Button size="sm" onClick={() => email && dev.mutate(email)} disabled={!email}>
              As the email above
            </Button>
          </div>
          {dev.isError ? <ErrorCallout error={dev.error} /> : null}
        </section>
      ) : null}
      <section className="small muted stack-sm" aria-labelledby="data-h">
        <h2 id="data-h" style={{ fontSize: "var(--text-sm)" }}>What we do with your data</h2>
        <p>{DATA_STATEMENT}</p>
      </section>
    </div>
  );
}

/** `/`: the last product this browser used, else the first product, else first-run setup. */
export function Home() {
  const products = useProducts();
  if (products.isPending) return <div className="center-page"><Loading /></div>;
  if (products.isError) return <div className="center-page"><ErrorCallout error={products.error} onRetry={() => products.refetch()} /></div>;
  const last = lastProduct();
  const items = products.data.items;
  if (last && items.some((p) => p.path === last)) return <Navigate to={`/t/${last}/objectives`} replace />;
  if (items[0]) return <Navigate to={`/t/${items[0].path}/objectives`} replace />;
  if (products.data.tenants.length) return <Navigate to="/products" replace />;
  return <Navigate to="/welcome" replace />;
}

export function AcceptInvite() {
  const { token = "" } = useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const accept = useMutation({
    mutationFn: () => api<{ tenant: { slug: string; name: string }; role: string }>("POST", "/api/v1/invitations/accept", { token }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["products"] });
      navigate("/products", { replace: true });
    },
  });
  useEffect(() => {
    accept.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);
  return (
    <div className="center-page stack">
      <h1>Joining…</h1>
      {accept.isError ? <ErrorCallout title="This invitation could not be used" error={accept.error} /> : <Loading />}
    </div>
  );
}
