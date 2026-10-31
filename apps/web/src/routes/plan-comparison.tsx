import type { ReactNode } from "react";
import { amount, anyPriced, size, type Amount, type Limit, type Plan, type PlanEntry } from "../lib/limits.ts";
import { Glyph } from "../ui/glyph.tsx";
import { StatusBadge } from "../ui/feedback.tsx";
import "../styles/screens/plans.css";

/**
 * The plans this WhatBuild offers, side by side: a few numbers anyone reads at a glance, what every
 * plan has, and every limit behind a disclosure. The public site, the app's plans page, an
 * organization's plan and the instance's owners all show this one table. It takes its data as props,
 * so the site's own small bundle can show it without the app's data layer.
 */
export function PlanComparison({ plans, limits, fileMaxBytes, current, every = "closed" }: {
  plans: PlanEntry[];
  limits: Limit[];
  /** The largest file this deployment takes on any plan, which caps every plan's. */
  fileMaxBytes: number;
  /** The plan of the organization being looked at, marked as its own. */
  current?: Plan;
  every?: "open" | "closed" | "none";
}) {
  const v = (p: PlanEntry, k: string) => p.limits[k] ?? null;
  const count = (n: Amount, one: string, many: string) => (n === null ? "No limit" : typeof n === "number" ? `${n.toLocaleString("en-US")} ${n === 1 ? one : many}` : "");
  const rows: { label: string; note?: string; cell: (p: PlanEntry) => ReactNode }[] = [
    { label: "People", note: "Readers of the Story are free and don’t count.", cell: (p) => count(v(p, "members_max"), "person", "people") },
    { label: "Products", note: "One product is one discovery. Archived ones count.", cell: (p) => count(v(p, "products_max"), "product", "products") },
    { label: "Sources", note: "Interviews, calls, documents. Archived ones count.", cell: (p) => count(v(p, "sources_max"), "source", "sources") },
    { label: "Storage", note: "Files and text together.", cell: (p) => amount(v(p, "storage_max_bytes"), "bytes") },
    { label: "Largest file", cell: (p) => size(Math.min(fileMaxBytes, Number(v(p, "file_max_bytes") ?? fileMaxBytes))) },
    { label: "Recordings, images and any file kept", note: "Text is read from documents on every plan.", cell: (p) => <Has yes={v(p, "documents_only") === false} /> },
    { label: "Your own agent, through MCP", cell: () => <Has yes /> },
    { label: "Readers who see only the Story", cell: () => <Has yes /> },
    { label: "Take everything out, any time", cell: () => <Has yes /> },
    { label: "Changes a day, each person", note: "By you or your agent.", cell: (p) => amount(v(p, "writes_per_day"), "") },
  ];
  return (
    <div className="plans">
      <div className="plans-scroll">
        <table className="plans-table">
          <thead>
            <tr>
              <th scope="col" className="plans-corner">
                <span className="visually-hidden">What each plan includes</span>
              </th>
              {plans.map((p) => (
                <th key={p.id} scope="col" className="plans-head" aria-current={current === p.id ? "true" : undefined}>
                  <span className="plans-name">
                    {p.name}
                    {current === p.id ? <StatusBadge tone="positive">Your plan</StatusBadge> : null}
                  </span>
                  {p.price ? <span className="plans-price">{p.price}</span> : null}
                  <span className="plans-about">{p.about}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <th scope="row">
                  {r.label}
                  {r.note ? <span className="plans-note">{r.note}</span> : null}
                </th>
                {plans.map((p) => (
                  <td key={p.id} className="num">
                    {r.cell(p)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="plans-foot">
        Each organization has a plan of its own{anyPriced(plans) ? " and is billed on its own" : ""}: a second organization is a second plan. Everyone in an organization meets its plan&rsquo;s limits, owners and
        their agents included.
      </p>
      {every === "none" ? null : (
        <details className="plans-every" open={every === "open"}>
          <summary>
            <Glyph name="chevron-right" size="sm" className="plans-every-chevron" />
            Every limit
          </summary>
          <div className="plans-scroll">
            <table className="plans-table plans-table-every">
              <thead>
                <tr>
                  <th scope="col">Limit</th>
                  <th scope="col">Counted over</th>
                  {plans.map((p) => (
                    <th key={p.id} scope="col" className="num">
                      {p.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {limits.map((l) => (
                  <tr key={l.key}>
                    <th scope="row">
                      {l.label}
                      <span className="plans-note">{l.help}</span>
                    </th>
                    <td className="plans-per">{l.per}</td>
                    {plans.map((p) => (
                      <td key={p.id} className="num">
                        {amount(v(p, l.key), l.unit)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}

/** Included or not, as a mark a screen reader reads as a word. */
function Has({ yes }: { yes: boolean }) {
  return (
    <span className={`plans-has${yes ? " plans-yes" : ""}`}>
      <Glyph name={yes ? "check" : "minus"} />
      <span className="visually-hidden">{yes ? "Included" : "Not included"}</span>
    </span>
  );
}
