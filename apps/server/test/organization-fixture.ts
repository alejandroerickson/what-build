import { expect } from "vitest";
import type { Browser, Harness } from "./harness.ts";

/**
 * An organization with something in every kind of row a product holds: outcomes and their
 * revisions, tagged sources with files, derivations, passages, annotations and agent notes, assumptions
 * with citations, links and reviews, a Story with a style, a hierarchy, notes and a promoted mockup
 * page, a mockup with files and a canvas upload, lineage, an export, an invitation and a second member. Every text it
 * writes carries `marker`, so a test can tell whether any of it reached someone else.
 */
export interface Organization {
  /** The string every text it writes carries. */
  marker: string;
  owner: Browser;
  ownerAccountId: string;
  tenant: { id: string; slug: string };
  team: { id: string; slug: string };
  /** Its main product, and a second one in the same team (a target for moving and copying sources). */
  product: { id: string; slug: string; path: string; etag: string };
  annex: { id: string; path: string };
  outcome: { id: string; etag: string };
  /** Its first source, tagged with `tag` among others. */
  source: { id: string; etag: string; path: string; fileVersionId: string; derivationId: string; tag: string };
  view: { id: string; etag: string };
  annotation: { id: string; etag: string };
  assumption: { id: string; etag: string };
  linked: { id: string; etag: string };
  page: { id: string; etag: string; notesEtag: string };
  promotedPage: { id: string };
  hierarchyEtag: string;
  styleEtag: string;
  mockup: { id: string; etag: string; pageId: string };
  exportId: string;
  invitationId: string;
  member: { accountId: string; email: string };
  /** Distinctive strings and ids that belong to this organization alone. */
  secrets: string[];
}

const ok = (r: { status: number; body: unknown }, status = 201) => {
  expect(r.status, JSON.stringify(r.body)).toBe(status);
  return r.body as any;
};

export async function buildOrganization(h: Harness, owner: Browser, name: string, marker: string): Promise<Organization> {
  const me = ok(await owner.api("GET", "/api/v1/me"), 200);
  const t = ok(await owner.api("POST", "/api/v1/tenants", { name }));
  const tenant = { id: t.tenant.tenant_id as string, slug: t.tenant.slug as string };
  const team = { id: t.team.team_id as string, slug: t.team.slug as string };
  const p = ok(await owner.api("POST", `/api/v1/teams/${tenant.slug}/${team.slug}/products`, { name: `${marker} Atlas`, concept: `${marker} concept: what the product is for.` }));
  const a = ok(await owner.api("POST", `/api/v1/teams/${tenant.slug}/${team.slug}/products`, { name: `${marker} Annex` }));
  const P = `/api/v1/p/${p.path}`;

  const o = ok(await owner.api("POST", `${P}/outcomes`, { title: `${marker} outcome: crews plan the week`, description: `${marker} outcome description.` }));
  const o2 = ok(await owner.api("PATCH", `${P}/outcomes/${o.outcome_id}`, { expected_etag: o.etag, description: `${marker} outcome, revised.` }), 200);

  // What the material is and whom it concerns are tags; both carry the marker, so facets and filters that cross over show.
  const src = ok(await owner.api("POST", `${P}/sources`, { title: `${marker} interview notes`, date: "2026-09-01", tags: ["interview", `${marker} Customer Co`, `${marker}-tag`] }));
  const notePath = "notes.md";
  ok(await owner.api("POST", `${P}/sources/${src.record_id}/notes`, { record_id: src.record_id, path: notePath, role: "primary", text: `# ${marker} visit\n\n${marker} crews text the office every Friday.\n\n${marker} nobody calls it a crisis.\n` }));
  await h.worker.drain();
  const detail = ok(await owner.api("GET", `${P}/sources/${src.record_id}?detail=full`), 200);
  const file = detail.files.find((f: { path: string }) => f.path === notePath);
  const derivations = ok(await owner.api("GET", `${P}/sources/${src.record_id}/derivations`), 200);
  expect(derivations.items[0].status).toBe("ready");
  ok(await owner.api("PUT", `${P}/sources/${src.record_id}/agent-notes/summary`, { content: `${marker} summary for agents.` }), 200);
  const ann = ok(await owner.api("POST", `${P}/sources/${src.record_id}/annotations`, { record_id: src.record_id, note: `${marker} annotation.`, seq_start: 0, seq_end: 1 }));

  const as = ok(await owner.api("POST", `${P}/assumptions`, { statement: `${marker} assumption: crews read texts first.`, citations: [{ record_id: src.record_id, seq_start: 1, seq_end: 1 }], outcome_ids: [o.outcome_id], author_type: "human" }));
  const linked = ok(await owner.api("POST", `${P}/assumptions`, { statement: `${marker} linked assumption.` }));
  const link = ok(await owner.api("POST", `${P}/assumptions/${as.id}/links`, { expected_etag: as.etag, target_id: linked.id, type: "supports" }), 200);
  ok(await owner.api("POST", `${P}/assumptions/${linked.id}/review`, { expected_etag: linked.etag, status: "confirmed", note: `${marker} review note.`, reviewer_type: "human" }), 200);
  // A source deleted for good leaves a tombstone.
  const gone = ok(await owner.api("POST", `${P}/sources`, { title: `${marker} mistaken upload` }));
  ok(await owner.api("DELETE", `${P}/sources/${gone.record_id}`, { expected_etag: gone.etag, reason: `${marker} uploaded by mistake`, confirm: "delete permanently" }), 200);

  const view = ok(await owner.api("POST", `${P}/sources`, { title: `${marker} view of the visits`, tags: ["view"], related_records: [src.record_id] }));
  const cap = ok(await owner.api("POST", `${P}/lineage/capture`, { inputs: [{ kind: "record", id: src.record_id }, { kind: "assumption", id: as.id }] }), 200);
  ok(await owner.api("POST", `${P}/sources/${view.record_id}/lineage`, { record_id: view.record_id, inputs: cap.inputs, captured_at: cap.captured_at, query_spec: { description: `${marker} lineage query.` } }), 200);

  const style = ok(await owner.api("PUT", `${P}/story/style`, { house_style: "report" }), 200);
  const page = ok(await owner.api("POST", `${P}/story/pages/${marker.toLowerCase()}-overview/versions`, {
    title: `${marker} where we stand`,
    body: `<h1>${marker} where we stand</h1><p>${marker} the Story says crews plan on Fridays.</p>`,
    refs: { outcomes: [o.outcome_id], sources: [src.record_id], assumptions: [as.id] },
    citations: [{ record_id: src.record_id, seq_start: 1, seq_end: 1 }],
  }));
  const notes = ok(await owner.api("PUT", `${P}/story/pages/${page.page_id}/notes`, { notes: `${marker} notes for agents.` }), 200);
  const tree = ok(await owner.api("PUT", `${P}/story/hierarchy`, { items: [{ page_id: page.page_id, children: [] }], expected_etag: null }), 200);

  const html = (title: string) => `<!doctype html><html lang="en"><head><title>${title}</title></head><body><p>${title}</p></body></html>`;
  const m = ok(await owner.api("POST", `${P}/mockups`, {
    title: `${marker} mockup`,
    brief: `${marker} brief: which screen tells crews the plan.`,
    pages: [{ page_id: `${marker.toLowerCase()}-plan`, title: `${marker} plan screen`, html: html(`${marker} plan screen`) }],
    files: [{ path: "DESIGN.md", content: `${marker} design notes.` }],
    refs: { assumptions: [as.id] },
  }));
  // A canvas upload in progress: its grant, with nothing published from it yet.
  ok(await owner.api("POST", `${P}/mockups/uploads`, {}));
  const promoted = ok(await owner.api("POST", `${P}/story/promote-mockup`, { mockup_id: m.mockup_id, mockup_page_id: `${marker.toLowerCase()}-plan`, title: `${marker} promoted plan` }));

  const ex = ok(await owner.api("POST", `${P}/exports`, {}));
  await h.worker.drain();

  const memberEmail = `${marker.toLowerCase()}-member@example.com`;
  ok(await owner.api("POST", `/api/v1/tenants/${tenant.slug}/members`, { team: team.slug, email: memberEmail, role: "viewer" }));
  const member = await h.signIn(memberEmail, `${marker} Member`);
  const memberId = ok(await member.api("GET", "/api/v1/me"), 200).account_id as string;
  const invited = ok(await owner.api("POST", `/api/v1/tenants/${tenant.slug}/members`, { product: p.product_id, email: `${marker.toLowerCase()}-invitee@example.com`, role: "editor" }));
  const members = ok(await owner.api("GET", `/api/v1/tenants/${tenant.slug}/members`), 200);
  const invitationId = invited.invitation_id ?? members.invitations?.[0]?.invitation_id;
  expect(invitationId, JSON.stringify(members)).toBeTruthy();

  const product = ok(await owner.api("GET", P), 200);
  const source = ok(await owner.api("GET", `${P}/sources/${src.record_id}`), 200);
  const viewNow = ok(await owner.api("GET", `${P}/sources/${view.record_id}`), 200);
  const linkedNow = ok(await owner.api("GET", `${P}/assumptions/${linked.id}`), 200);
  const org: Organization = {
    marker,
    owner,
    ownerAccountId: me.account_id,
    tenant,
    team,
    product: { id: p.product_id, slug: p.path.split("/")[2], path: p.path, etag: product.etag },
    annex: { id: a.product_id, path: a.path },
    outcome: { id: o.outcome_id, etag: o2.etag },
    source: { id: src.record_id, etag: source.etag, path: notePath, fileVersionId: file.current_version_id ?? file.file_version_id, derivationId: derivations.items[0].derivation_id, tag: `${marker.toLowerCase()}-tag` },
    view: { id: view.record_id, etag: viewNow.etag },
    annotation: { id: ann.annotation_id, etag: ann.etag },
    assumption: { id: as.id, etag: link.etag },
    linked: { id: linked.id, etag: linkedNow.etag },
    page: { id: page.page_id, etag: page.etag, notesEtag: notes.etag ?? notes.agent_notes_etag },
    promotedPage: { id: promoted.page_id },
    hierarchyEtag: tree.etag,
    styleEtag: style.etag,
    mockup: { id: m.mockup_id, etag: m.etag, pageId: `${marker.toLowerCase()}-plan` },
    exportId: ex.export_id,
    invitationId,
    member: { accountId: memberId, email: memberEmail },
    secrets: [],
  };
  org.secrets = [
    marker,
    marker.toLowerCase(),
    owner.email,
    memberEmail,
    tenant.id,
    tenant.slug,
    team.id,
    org.product.id,
    org.product.slug,
    org.annex.id,
    org.outcome.id,
    org.source.id,
    org.source.fileVersionId,
    org.source.derivationId,
    org.view.id,
    org.annotation.id,
    org.assumption.id,
    org.linked.id,
    org.page.id,
    org.promotedPage.id,
    org.mockup.id,
    org.exportId,
    org.invitationId,
    org.ownerAccountId,
    memberId,
  ].filter(Boolean);
  return org;
}
