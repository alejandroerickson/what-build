import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useMemo, useState, type ReactNode } from "react";
import { api } from "../lib/api.ts";
import { readAddressList } from "../lib/address-list.ts";
import { plural, ROLE_WORD, scopeWords } from "../lib/format.ts";
import { Avatar, Button, Callout, Dialog, ErrorCallout, FindField, Glyph, IconButton, Segmented, StatusBadge, TextArea, useToast } from "../ui/index.tsx";
import "../styles/screens/people-editor.css";

/**
 * Who has a role on a product, a team or the organization, changed many at a time. People picked
 * from the organization, or read from a pasted list of addresses, move across to the target with a
 * role each, beside the people already there, whose roles change and who come off it the same way.
 * Nothing changes until it is saved, and then in one call (`members.grant_many`), with a
 * `members.revoke` for each person taken off.
 */

export interface Grant {
  membership_id: string;
  scope_type: "tenant" | "team" | "product";
  scope_id: string;
  scope: { name: string; slug?: string };
  role: string;
}
export interface OrgPerson {
  account_id: string;
  display_name: string;
  email: string;
  grants: Grant[];
}
export interface PendingInvitation {
  email: string;
  scope_type: string;
  scope_id: string;
}

/** Where the roles are given, as the members operations name it. */
export interface EditorTarget {
  scope_type: "tenant" | "team" | "product";
  scope_id: string;
  /** The team a product is in, whose roles reach it. */
  team_id: string | null;
  team_name?: string;
  name: string;
  /** The request fields that name it: none for the organization. */
  body: { team?: string; product?: string };
  /** The roles the caller may give there, highest first. */
  roles: string[];
  /** The role someone added joins with until it is changed. */
  defaultRole: string;
}

export interface InvitationMade {
  email: string;
  invite_link: string;
  emailed: boolean;
}

const RANK: Record<string, number> = { reader: 0, member: 0, viewer: 1, editor: 2, admin: 3, owner: 4 };
export const ROLE_HINT: Record<string, string> = {
  owner: "Admin of everything, and makes owners",
  admin: "Also manages people and settings",
  member: "Opens only what they have a role on",
  editor: "Reads and writes",
  viewer: "Reads",
  reader: "Reads only the Story",
};
/** The most people one `members.grant_many` call takes; more go in calls of this many. */
const PER_CALL = 100;

interface Holder {
  account_id: string;
  name: string;
  email: string;
  /** Their role at exactly this scope, if they hold one. */
  own: string | null;
  /** Access from a broader grant that outranks any role of their own here: their team's, or the organization's. */
  through: { role: string; kind: "tenant" | "team"; words: string; keeps: string } | null;
  /** Whether the caller may change their role here (give one, when they have none of their own). */
  editable: boolean;
  /** Their one role in the organization, so taking it takes them out of it. */
  only: boolean;
}

interface Added {
  /** The address in lower case: the row's key. */
  key: string;
  email: string;
  name: string | null;
  account_id: string | null;
  role: string;
}

function holdersOf(people: OrgPerson[], target: EditorTarget, canEdit: (p: OrgPerson, own: Grant | null) => boolean, partial: boolean): Holder[] {
  const out: Holder[] = [];
  for (const p of people) {
    const own = p.grants.find((g) => g.scope_type === target.scope_type && g.scope_id === target.scope_id) ?? null;
    let through: Holder["through"] = null;
    if (target.scope_type !== "tenant") {
      const org = p.grants.find((g) => g.scope_type === "tenant" && (g.role === "owner" || g.role === "admin"));
      const team = target.scope_type === "product" ? p.grants.find((g) => g.scope_type === "team" && g.scope_id === target.team_id) : undefined;
      const teamWords = scopeWords("team", target.team_name ?? team?.scope.name ?? "");
      if (org) through = { role: "admin", kind: "tenant", words: `Organization ${org.role}`, keeps: `stays admin as an organization ${org.role}` };
      else if (team) through = { role: team.role, kind: "team", words: `${ROLE_WORD[team.role]} on ${teamWords}`, keeps: `stays ${team.role} on ${teamWords}` };
      // A broader role that doesn't outrank theirs here changes nothing.
      if (through && own && RANK[own.role]! >= RANK[through.role]!) through = null;
    }
    if (!own && !through) continue;
    out.push({
      account_id: p.account_id,
      name: p.display_name,
      email: p.email,
      own: own?.role ?? null,
      through,
      // Nothing outranks an admin through the organization, so a role of their own here would change nothing.
      editable: canEdit(p, own) && Boolean(own || through?.role !== "admin"),
      only: !partial && p.grants.length === 1 && Boolean(own),
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

const people = (n: number) => plural(n, "person", "people");

export function PeopleEditor({ tenant, orgName, target, title, description, above, members, partial, invitations, canEdit, initialAdd, onClose }: {
  tenant: string;
  orgName: string;
  target: EditorTarget;
  title: string;
  description: string;
  /** Anything that goes above the two lists, such as where the roles are given. */
  above?: ReactNode;
  /** Everyone in the organization the caller sees, with their grants. */
  members: OrgPerson[];
  /** The list holds only the people on what the caller reads. */
  partial: boolean;
  invitations: PendingInvitation[];
  /** Whether the caller may change this person's role here, or give them one. */
  canEdit: (p: OrgPerson, own: Grant | null) => boolean;
  /** Addresses already chosen when it opens (a member's own Give access). */
  initialAdd?: string[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const id = useId();
  const where = target.scope_type === "tenant" ? orgName : scopeWords(target.scope_type, target.name);
  const holders = holdersOf(members, target, canEdit, partial);
  const holderIds = new Set(holders.map((h) => h.account_id));
  const holderEmails = new Set(holders.map((h) => h.email.toLowerCase()));
  const byEmail = useMemo(() => new Map(members.map((p) => [p.email.toLowerCase(), p])), [members]);
  const invitedHere = new Set(invitations.filter((i) => i.scope_type === target.scope_type && i.scope_id === target.scope_id).map((i) => i.email.toLowerCase()));
  const candidates = members.filter((p) => !holderIds.has(p.account_id)).sort((a, b) => a.display_name.localeCompare(b.display_name));
  const firstAdded = (): Added[] =>
    (initialAdd ?? [])
      .map((email) => byEmail.get(email.toLowerCase()))
      .filter((p): p is OrgPerson => Boolean(p) && !holderIds.has(p!.account_id))
      .map((p) => ({ key: p.email.toLowerCase(), email: p.email, name: p.display_name, account_id: p.account_id, role: target.defaultRole }));

  const [added, setAdded] = useState<Added[]>(firstAdded);
  const [roleOf, setRoleOf] = useState<Record<string, string>>({});
  const [removed, setRemoved] = useState<Set<string>>(() => new Set());
  const [joinAs, setJoinAs] = useState(target.defaultRole);
  const [chosenMode, setMode] = useState<"org" | "paste">("org");
  // With nobody left to pick from the organization, the only way to add someone is their address.
  const mode = candidates.length ? chosenMode : "paste";
  const [find, setFind] = useState("");
  const [pickedLeft, setPickedLeft] = useState<Set<string>>(() => new Set());
  const [pickedRight, setPickedRight] = useState<Set<string>>(() => new Set());
  const [pasted, setPasted] = useState("");
  const [skipped, setSkipped] = useState<Set<string>>(() => new Set());
  const [said, setSaid] = useState("");
  const [made, setMade] = useState<InvitationMade[] | null>(null);
  // Another target is another set of people and roles: what was chosen for the last one starts again.
  const targetKey = `${target.scope_type}:${target.scope_id}`;
  const [shownFor, setShownFor] = useState(targetKey);
  if (shownFor !== targetKey) {
    setShownFor(targetKey);
    setAdded((a) => a.filter((x) => !x.account_id || !holderIds.has(x.account_id)).map((x) => ({ ...x, role: target.roles.includes(x.role) ? x.role : target.defaultRole })));
    setRoleOf({});
    setRemoved(new Set());
    setPickedRight(new Set());
    setPickedLeft(new Set());
    setJoinAs(target.roles.includes(joinAs) ? joinAs : target.defaultRole);
  }

  const addedKeys = new Set(added.map((a) => a.key));
  const needle = find.trim().toLowerCase();
  const offered = candidates.filter((p) => !addedKeys.has(p.email.toLowerCase()));
  const shown = needle ? offered.filter((p) => p.display_name.toLowerCase().includes(needle) || p.email.toLowerCase().includes(needle)) : offered;

  const read = useMemo(() => readAddressList(pasted), [pasted]);
  const pasteRows = read.addresses.map((a) => {
    const key = a.email.toLowerCase();
    const person = byEmail.get(key) ?? null;
    const state = holderEmails.has(key) ? "holder" : addedKeys.has(key) ? "added" : person ? "member" : invitedHere.has(key) ? "invited" : "new";
    return { ...a, key, person, state, takes: state === "member" || state === "new" || state === "invited" };
  });
  const pasteReady = pasteRows.filter((r) => r.takes && !skipped.has(r.key));
  const leftCount = mode === "org" ? offered.filter((p) => pickedLeft.has(p.account_id)).length : pasteReady.length;

  const toggle = (set: Set<string>, key: string, on: boolean) => {
    const next = new Set(set);
    if (on) next.add(key);
    else next.delete(key);
    return next;
  };

  const moveRight = () => {
    const chosen: Added[] =
      mode === "org"
        ? offered.filter((p) => pickedLeft.has(p.account_id)).map((p) => ({ key: p.email.toLowerCase(), email: p.email, name: p.display_name, account_id: p.account_id, role: joinAs }))
        : pasteReady.map((r) => ({ key: r.key, email: r.person?.email ?? r.email, name: r.person?.display_name ?? r.name, account_id: r.person?.account_id ?? null, role: joinAs }));
    if (!chosen.length) return;
    setAdded((a) => [...chosen, ...a]);
    if (mode === "org") setPickedLeft(new Set());
    else {
      setPasted("");
      setSkipped(new Set());
    }
    setSaid(`Moved ${people(chosen.length)} across as ${ROLE_WORD[joinAs]?.toLowerCase()}. Nothing changes until you save.`);
  };

  const removable = target.scope_type !== "tenant";
  const moveLeft = () => {
    const back = added.filter((a) => pickedRight.has(`new:${a.key}`));
    const off = removable ? holders.filter((h) => pickedRight.has(h.account_id) && h.own) : [];
    if (!back.length && !off.length) return;
    setAdded((a) => a.filter((x) => !pickedRight.has(`new:${x.key}`)));
    setRemoved((r) => new Set([...r, ...off.map((h) => h.account_id)]));
    setPickedRight(new Set());
    setSaid([back.length ? `Moved ${people(back.length)} back` : "", off.length ? `${people(off.length)} taken off ${where} when you save` : ""].filter(Boolean).join(". ") + ".");
  };

  const pickable = (h: Holder) => h.editable && !removed.has(h.account_id);
  const rightPicked = [...added.map((a) => `new:${a.key}`), ...holders.filter(pickable).map((h) => h.account_id)].filter((k) => pickedRight.has(k));
  const canTakeOff = rightPicked.some((k) => k.startsWith("new:") || (removable && holders.some((h) => h.account_id === k && h.own)));
  const setRoleForPicked = (role: string) => {
    setAdded((a) => a.map((x) => (pickedRight.has(`new:${x.key}`) ? { ...x, role } : x)));
    setRoleOf((r) => {
      const next = { ...r };
      for (const h of holders) if (pickedRight.has(h.account_id) && pickable(h)) next[h.account_id] = role;
      return next;
    });
    setSaid(`${people(rightPicked.length)} set to ${ROLE_WORD[role]?.toLowerCase()}.`);
  };

  const changed = holders.filter((h) => !removed.has(h.account_id) && roleOf[h.account_id] && roleOf[h.account_id] !== (h.own ?? ""));
  const takenOff = holders.filter((h) => removed.has(h.account_id));
  const grants = [...added.map((a) => ({ email: a.email, role: a.role })), ...changed.map((h) => ({ email: h.email, role: roleOf[h.account_id]! }))];
  const pending = grants.length + takenOff.length;
  const summary = [
    added.length ? `${people(added.length)} to add` : "",
    changed.length ? `${plural(changed.length, "role")} to change` : "",
    takenOff.length ? `${people(takenOff.length)} to take off` : "",
  ].filter(Boolean);

  // What would be saved: a refusal is about these changes, and is forgotten once they change.
  const changes = JSON.stringify([grants, takenOff.map((h) => h.account_id)]);
  const save = useMutation({
    mutationFn: async (_changes: string) => {
      const invited: InvitationMade[] = [];
      let given = 0;
      for (let i = 0; i < grants.length; i += PER_CALL) {
        const r = await api<{ results: { email: string; invited: boolean; invite_link?: string; emailed?: false }[] }>("POST", `/api/v1/tenants/${tenant}/members/many`, {
          ...target.body,
          people: grants.slice(i, i + PER_CALL),
        });
        for (const x of r.results) {
          if (x.invited && x.invite_link) invited.push({ email: x.email, invite_link: x.invite_link, emailed: x.emailed !== false });
          else if (!x.invited) given++;
        }
      }
      const failed: string[] = [];
      for (const h of takenOff) {
        try {
          await api("POST", `/api/v1/tenants/${tenant}/members/revoke`, { ...target.body, account_id: h.account_id });
        } catch {
          failed.push(h.name);
        }
      }
      return { invited, given, failed };
    },
    onSuccess: ({ invited, given, failed }) => {
      void qc.invalidateQueries({ queryKey: ["members", tenant] });
      if (failed.length) toast(`Couldn’t take ${failed.join(", ")} off ${where}. Everything else is saved.`, { tone: "negative" });
      // Someone invited isn't there until they accept, so the toast says which happened.
      else if (added.length && !changed.length && !takenOff.length)
        toast(given && invited.length ? `Added ${people(given)} to ${where} and invited ${invited.length}.` : invited.length ? `Invited ${people(invited.length)} to ${where}.` : `Added ${people(given)} to ${where}.`);
      else toast(`Saved the changes to ${where}.`);
      if (invited.length) setMade(invited);
      else onClose();
    },
  });

  const count = holders.length - takenOff.length + added.length;
  const own = holders.filter((h) => !h.through);
  const via = holders.filter((h) => h.through);
  const viaKinds = new Set(via.map((h) => h.through!.kind));
  const teamWords = scopeWords("team", target.team_name ?? "");
  const labelled = [added.length, own.length, via.length].filter(Boolean).length > 1;
  const viaLabel = viaKinds.size === 2 ? `Through ${teamWords} or ${orgName}` : viaKinds.has("team") ? `Through ${teamWords}` : `Through ${orgName}`;

  if (made)
    return (
      <Dialog open wide className="pe-dialog" onClose={onClose} title={title} footer={<Button variant="primary" onClick={onClose}>Done</Button>}>
        <InvitationsMade made={made} />
      </Dialog>
    );

  const holderRow = (h: Holder) => {
    const off = removed.has(h.account_id);
    const role = roleOf[h.account_id] ?? h.own ?? "";
    const was = h.own && role !== h.own ? h.own : null;
    return (
      <li key={h.account_id} className={`pe-row${off ? " pe-row-gone" : ""}`}>
        {pickable(h) ? (
          <input type="checkbox" aria-label={`Choose ${h.name}`} checked={pickedRight.has(h.account_id)} onChange={(e) => setPickedRight(toggle(pickedRight, h.account_id, e.target.checked))} />
        ) : (
          <span className="pe-check-none" aria-hidden="true" />
        )}
        <Avatar name={h.name} />
        <span className="pe-who">
          <span className="pe-name">{h.name}</span>
          <span className="pe-sub">
            {off
              ? `Taken off when you save${h.through ? `; ${h.through.keeps}` : h.only ? `, and out of ${orgName}: it’s their only role there` : ""}`
              : h.through
                ? `${h.through.words}${h.own ? `, which outranks ${h.own} here` : ""}`
                : was
                  ? `${h.email} · was ${was}`
                  : h.email}
          </span>
        </span>
        {off ? (
          <Button size="sm" variant="quiet" onClick={() => setRemoved((r) => toggle(r, h.account_id, false))}>
            Keep
          </Button>
        ) : h.editable ? (
          <RoleSelect
            label={`Role for ${h.name}`}
            roles={h.own && !target.roles.includes(h.own) ? [h.own, ...target.roles] : target.roles}
            none={h.own ? undefined : `${ROLE_WORD[h.through!.role]} (team)`}
            value={role}
            onChange={(r) => setRoleOf((x) => ({ ...x, [h.account_id]: r }))}
          />
        ) : (
          <span className="pe-role-text">{ROLE_WORD[h.through?.role ?? h.own!]}</span>
        )}
      </li>
    );
  };

  return (
    <Dialog
      open
      wide
      className="pe-dialog"
      onClose={onClose}
      dismissable={!save.isPending}
      title={title}
      description={description}
      footer={
        <>
          <span className="pe-summary">{summary.length ? `${summary.join(", ")}.` : "Nothing changes until you save."}</span>
          <Button onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button variant="primary" busy={save.isPending} busyLabel="Saving…" disabled={!pending} onClick={() => save.mutate(changes)}>
            {added.length && !changed.length && !takenOff.length ? `Add ${people(added.length)}` : "Save changes"}
          </Button>
        </>
      }
    >
      <div className="pe">
        {above}
        <div className="pe-columns">
          <section className="pe-col" aria-labelledby={`${id}-from`}>
            <h3 id={`${id}-from`} className="visually-hidden">
              Who to add
            </h3>
            <div className="pe-col-head">
              <Segmented
                label="Who to add"
                equal
                className="pe-modes"
                value={mode}
                onChange={(m) => setMode(m as "org" | "paste")}
                items={[
                  { id: "org", label: "From the organization", disabled: !candidates.length },
                  { id: "paste", label: "Paste addresses" },
                ]}
              />
            </div>
            {mode === "org" ? (
              <>
                {offered.length > 6 ? (
                  <div className="pe-col-tools">
                    <FindField label="Find by name or address" value={find} onChange={(e) => setFind(e.target.value)} />
                  </div>
                ) : null}
                {shown.length ? (
                  <>
                    <label className="pe-row pe-all">
                      <input
                        type="checkbox"
                        checked={shown.every((p) => pickedLeft.has(p.account_id))}
                        ref={(el) => {
                          if (el) el.indeterminate = shown.some((p) => pickedLeft.has(p.account_id)) && !shown.every((p) => pickedLeft.has(p.account_id));
                        }}
                        onChange={(e) => {
                          const next = new Set(pickedLeft);
                          for (const p of shown) {
                            if (e.target.checked) next.add(p.account_id);
                            else next.delete(p.account_id);
                          }
                          setPickedLeft(next);
                        }}
                      />
                      <span className="pe-who">
                        <span className="pe-name">Select all</span>
                      </span>
                      <span className="pe-count num">{shown.length}</span>
                    </label>
                    <ul className="pe-list" aria-label={`People in ${orgName} not on ${where}`}>
                      {shown.map((p) => (
                        <li key={p.account_id}>
                          <label className="pe-row">
                            <input type="checkbox" checked={pickedLeft.has(p.account_id)} onChange={(e) => setPickedLeft(toggle(pickedLeft, p.account_id, e.target.checked))} />
                            <Avatar name={p.display_name} />
                            <span className="pe-who">
                              <span className="pe-name">{p.display_name}</span>
                              <span className="pe-sub">{p.email}</span>
                            </span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <div className="pe-empty">
                    <p>
                      {needle
                        ? `Nobody matches “${find.trim()}”.`
                        : target.scope_type === "tenant"
                          ? "Everyone in the organization you can see has a role in it."
                          : `Everyone in the organization you can see is on ${where}${added.length ? " or moved across" : ""}.`}
                    </p>
                    <Button size="sm" variant="quiet" onClick={() => setMode("paste")}>
                      Paste addresses instead
                    </Button>
                  </div>
                )}
                {partial ? <p className="pe-note">Only the people on the teams and products you can open are listed.</p> : null}
              </>
            ) : (
              <>
                <div className="pe-col-tools">
                  <TextArea
                    label="Addresses"
                    rows={4}
                    value={pasted}
                    spellCheck={false}
                    autoComplete="off"
                    placeholder="ana@example.com, Ben Ito <ben@example.com>; …"
                    hint="From email, a spreadsheet or any list, with or without names."
                    onChange={(e) => setPasted(e.target.value)}
                  />
                </div>
                {read.unreadable.length || read.repeated ? (
                  <div className="pe-col-tools">
                    <Callout inset tone="attention">
                      {read.unreadable.length ? (
                        <>
                          Left out, not {read.unreadable.length === 1 ? "an address" : "addresses"}: <span className="pe-unreadable">{read.unreadable.join(", ")}</span>.{" "}
                        </>
                      ) : null}
                      {read.repeated ? `${plural(read.repeated, "repeated address", "repeated addresses")} ${read.repeated === 1 ? "is" : "are"} listed once.` : null}
                    </Callout>
                  </div>
                ) : null}
                {pasteRows.length ? (
                  <ul className="pe-list" aria-label="Addresses read">
                    {pasteRows.map((r) => (
                      <li key={r.key}>
                        <label className={`pe-row${r.takes ? "" : " pe-row-off"}`}>
                          <input type="checkbox" disabled={!r.takes} checked={r.takes && !skipped.has(r.key)} onChange={(e) => setSkipped(toggle(skipped, r.key, !e.target.checked))} />
                          <Face name={r.person?.display_name ?? null} />
                          <span className="pe-who">
                            <span className="pe-name">{r.person?.display_name ?? r.name ?? r.email}</span>
                            <span className="pe-sub">
                              {r.person || r.name ? `${r.email} · ` : ""}
                              {r.state === "holder"
                                ? target.scope_type === "tenant"
                                  ? `already has a role in ${orgName}`
                                  : `already on ${where}`
                                : r.state === "added"
                                  ? "already moved across"
                                  : r.state === "member"
                                    ? "in the organization"
                                    : r.state === "invited"
                                      ? "invited already; gets a new invitation"
                                      : "gets an invitation"}
                            </span>
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </>
            )}
            <div className="pe-join">
              <label className="pe-join-label" htmlFor={`${id}-join`}>
                Join as
              </label>
              <span className="select-wrap">
                <select id={`${id}-join`} className="input select" value={joinAs} onChange={(e) => setJoinAs(e.target.value)} aria-describedby={`${id}-join-hint`}>
                  {target.roles.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_WORD[r]}
                    </option>
                  ))}
                </select>
                <Glyph name="chevron-down" size="sm" />
              </span>
              <span id={`${id}-join-hint`} className="pe-join-hint">
                {ROLE_HINT[joinAs]}
              </span>
            </div>
          </section>

          <div className="pe-move" role="group" aria-label="Move people">
            <IconButton
              icon="arrow-right"
              label={leftCount ? `Add ${people(leftCount)} to ${where}` : `Choose people to add to ${where}`}
              className="pe-move-btn"
              disabled={!leftCount}
              onClick={moveRight}
            />
            <IconButton
              icon="arrow-left"
              label={canTakeOff ? `Take ${people(rightPicked.length)} off ${where}` : `Choose people to take off ${where}`}
              className="pe-move-btn"
              disabled={!canTakeOff}
              onClick={moveLeft}
            />
          </div>

          <section className="pe-col" aria-labelledby={`${id}-to`}>
            <div className="pe-col-head">
              <h3 id={`${id}-to`} className="pe-col-title">
                {target.scope_type === "tenant" ? `Roles in ${orgName}` : `On ${where}`}
                <span className="pe-count num">{count}</span>
              </h3>
              {rightPicked.length ? (
                <div className="pe-bulk">
                  <span className="pe-bulk-count">{rightPicked.length} chosen</span>
                  <span className="select-wrap">
                    <select className="input select" aria-label={`Role for the ${people(rightPicked.length)} chosen`} value="" onChange={(e) => e.target.value && setRoleForPicked(e.target.value)}>
                      <option value="">Set role…</option>
                      {target.roles.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_WORD[r]}
                        </option>
                      ))}
                    </select>
                    <Glyph name="chevron-down" size="sm" />
                  </span>
                  <IconButton icon="x" size="sm" label="Clear the choice" onClick={() => setPickedRight(new Set())} />
                </div>
              ) : null}
            </div>
            {count ? (
              <div className="pe-list" role="group" aria-label={target.scope_type === "tenant" ? `Roles in ${orgName}` : `People on ${where}`}>
                {added.length ? (
                  <>
                    {labelled ? (
                      <p className="pe-group" id={`${id}-add`}>
                        To add
                      </p>
                    ) : null}
                    <ul aria-labelledby={labelled ? `${id}-add` : undefined}>
                      {added.map((a) => (
                        <li key={`new:${a.key}`} className="pe-row">
                          <input type="checkbox" aria-label={`Choose ${a.name ?? a.email}`} checked={pickedRight.has(`new:${a.key}`)} onChange={(e) => setPickedRight(toggle(pickedRight, `new:${a.key}`, e.target.checked))} />
                          <Face name={a.account_id ? (a.name ?? a.email) : null} />
                          <span className="pe-who">
                            <span className="pe-name">{a.name ?? a.email}</span>
                            <span className="pe-sub">
                              {a.name ? a.email : null}
                              {a.account_id ? null : <span className="pe-state">{a.name ? " · " : ""}gets an invitation</span>}
                            </span>
                          </span>
                          <RoleSelect label={`Role for ${a.name ?? a.email}`} roles={target.roles} value={a.role} onChange={(role) => setAdded((xs) => xs.map((x) => (x.key === a.key ? { ...x, role } : x)))} />
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
                {own.length ? (
                  <>
                    {labelled ? (
                      <p className="pe-group" id={`${id}-own`}>
                        Already here
                      </p>
                    ) : null}
                    <ul aria-labelledby={labelled ? `${id}-own` : undefined}>{own.map(holderRow)}</ul>
                  </>
                ) : null}
                {via.length ? (
                  <>
                    <p className="pe-group" id={`${id}-via`}>
                      {viaLabel}
                    </p>
                    <ul aria-labelledby={`${id}-via`}>{via.map(holderRow)}</ul>
                  </>
                ) : null}
              </div>
            ) : (
              <p className="pe-empty">Nobody here yet. Choose people on the left and move them across.</p>
            )}
          </section>
        </div>
        <p className="visually-hidden" role="status" aria-live="polite">
          {said}
        </p>
        {save.isError && save.variables === changes ? <ErrorCallout inset error={save.error} /> : null}
      </div>
    </Dialog>
  );
}

/** A person's initials, or an empty ring for someone with no account yet. */
function Face({ name }: { name: string | null }) {
  return name ? (
    <Avatar name={name} />
  ) : (
    <span className="pe-face-empty" aria-hidden="true">
      <Glyph name="clock" size="sm" />
    </span>
  );
}

/**
 * A role, chosen in a row. `none` names the role someone has through a broader grant, chosen
 * until they are given one of their own here.
 */
function RoleSelect({ label, roles, value, none, onChange }: { label: string; roles: string[]; value: string; none?: string; onChange: (role: string) => void }) {
  return (
    <span className="select-wrap pe-role">
      <select className="input select" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
        {none ? <option value="">{none}</option> : null}
        {roles.map((r) => (
          <option key={r} value={r}>
            {ROLE_WORD[r]}
          </option>
        ))}
      </select>
      <Glyph name="chevron-down" size="sm" />
    </span>
  );
}

/** The invitations a save made, with each link to copy, for anyone the email may not reach. */
export function InvitationsMade({ made }: { made: InvitationMade[] }) {
  const toast = useToast();
  const unsent = made.filter((m) => !m.emailed).length;
  const copy = (text: string, said: string) =>
    navigator.clipboard
      .writeText(text)
      .then(() => toast(said))
      .catch(() => toast("Couldn’t copy. Select the link and copy it yourself.", { tone: "negative" }));
  return (
    <div className="stack-sm">
      <Callout inset tone={unsent ? "attention" : "positive"} title={made.length === 1 ? "Invitation created" : `${made.length} invitations created`}>
        {unsent
          ? `${plural(unsent, "invitation")} couldn’t be emailed: copy ${unsent === 1 ? "its link" : "their links"} and send ${unsent === 1 ? "it" : "them"} yourself.`
          : "Each joins when they accept. We email the invitations where email is set up, and you can share each link yourself: it works once, within 7 days, and only for its address."}
      </Callout>
      <ul className="pe-links">
        {made.map((m) => (
          <li key={m.email} className="pe-link-row">
            <span className="pe-name">{m.email}</span>
            {m.emailed ? null : <StatusBadge tone="attention">Not emailed</StatusBadge>}
            <Button size="sm" icon="copy" aria-label={`Copy the invitation link for ${m.email}`} onClick={() => copy(m.invite_link, "Copied.")}>
              Copy link
            </Button>
          </li>
        ))}
      </ul>
      {made.length > 1 ? (
        <div>
          <Button size="sm" variant="quiet" icon="copy" onClick={() => copy(made.map((m) => `${m.email}\t${m.invite_link}`).join("\n"), "Copied every address with its link.")}>
            Copy every link
          </Button>
        </div>
      ) : null}
    </div>
  );
}
