import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useNavigate } from "react-router";
import { api, putWithProgress } from "../lib/api.ts";
import { formatBytes } from "../lib/format.ts";
import { useProduct } from "../lib/session.tsx";
import type { KindInfo } from "../lib/types.ts";
import { Badge, Button, Callout, ErrorCallout, Loading, PageHeader, SelectField, TextField } from "../ui/index.tsx";
import { useKinds } from "./sources.tsx";

type Role = "primary" | "origin" | "supplement";
interface Item {
  file: File;
  role: Role;
  state: "waiting" | "uploading" | "done" | "failed";
  loaded: number;
  error?: string;
}

const MiB = 1024 * 1024;
const RECORDING = /^(audio|video)\//;

function splitList(s: string): string[] {
  return [...new Set(s.split(",").map((x) => x.trim()).filter(Boolean))];
}

function destination(kind: KindInfo | undefined, date: string): string {
  if (!kind) return "";
  const labels: Record<string, string> = {
    interviews: "Interviews", "sales-calls": "Sales calls", research: "Research", "documents/wiki": "Documents › Wiki exports", "documents/prds": "Documents › Requirements",
    "documents/decks": "Documents › Decks", "documents/contracts": "Documents › Contracts", "documents/rfps": "Documents › RFPs", "documents/analysis": "Documents › Analysis",
    "documents/digests": "Documents › Digests", "documents/views": "Documents › Views", design: "Design", misc: "Other",
  };
  const root = labels[kind.root] ?? kind.root;
  return kind.dated ? `${root} › ${date ? date.slice(0, 4) : "Undated"}` : root;
}

/** Upload files to a source one after another, primary first, through grants — the same path agents use. */
export async function uploadFiles(base: string, recordId: string, items: Item[], update: (i: number, patch: Partial<Item>) => void) {
  const order = items.map((it, i) => ({ it, i })).sort((a, b) => (a.it.role === "primary" ? -1 : 0) - (b.it.role === "primary" ? -1 : 0));
  for (const { it, i } of order) {
    if (it.state === "done") continue;
    update(i, { state: "uploading", loaded: 0, error: undefined });
    try {
      const grant = await api<{ url: string; headers: Record<string, string>; max_bytes: number }>("POST", `${base}/sources/${recordId}/uploads`, {
        path: it.file.name,
        role: it.role,
        size: it.file.size,
        ...(it.file.type ? { media_type: it.file.type } : {}),
      });
      await putWithProgress(grant.url, grant.headers, it.file, (loaded) => update(i, { loaded }));
      update(i, { state: "done", loaded: it.file.size });
    } catch (e) {
      update(i, { state: "failed", error: (e as Error).message });
    }
  }
}

function DropZone({ label, hint, multiple, onFiles }: { label: string; hint: string; multiple: boolean; onFiles: (files: File[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div
      className={`dropzone ${over ? "dropzone-over" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const files = [...e.dataTransfer.files];
        onFiles(multiple ? files : files.slice(0, 1));
      }}
    >
      <div className="stack-sm">
        <strong>{label}</strong>
        <p className="small muted">{hint}</p>
        <div>
          <Button size="sm" onClick={() => input.current?.click()}>
            Choose {multiple ? "files" : "a file"}
          </Button>
        </div>
      </div>
      <input ref={input} type="file" hidden multiple={multiple} onChange={(e) => onFiles([...(e.target.files ?? [])])} />
    </div>
  );
}

export function SourceNewPage() {
  const { api: base, app } = useProduct();
  const kinds = useKinds();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [step, setStep] = useState(0);
  const [kind, setKind] = useState("");
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [organization, setOrganization] = useState("");
  const [tags, setTags] = useState("");
  const [participants, setParticipants] = useState("");
  const [sourceSystem, setSourceSystem] = useState("");
  const [provenance, setProvenance] = useState("unknown");
  const [touched, setTouched] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [recordId, setRecordId] = useState<string | null>(null);
  const info = kinds.data?.kinds.find((k) => k.kind === kind);
  const errors = {
    title: !title.trim() ? "Say what this source is." : null,
    date: info?.dated && !date ? "This kind of source needs its date — when it happened, not today." : null,
    organization: info?.organizational && !organization.trim() ? "Name the organization this concerns." : null,
  };
  const describeOk = !errors.title && !errors.date && !errors.organization;
  const primary = items.find((i) => i.role === "primary");
  const update = (i: number, patch: Partial<Item>) => setItems((all) => all.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const run = useMutation({
    mutationFn: async () => {
      let rid = recordId;
      if (!rid) {
        const r = await api<{ record_id: string }>("POST", `${base}/sources`, {
          kind,
          title: title.trim(),
          date: date || null,
          organization: organization.trim() || null,
          tags: splitList(tags),
          participants: splitList(participants),
          source_system: sourceSystem.trim() || null,
          provenance_depth: provenance,
        });
        rid = r.record_id;
        setRecordId(rid);
      }
      await uploadFiles(base, rid, items, update);
      return rid;
    },
    onSuccess: async (rid) => {
      await qc.invalidateQueries({ queryKey: ["sources", base] });
      setItems((current) => {
        if (current.every((i) => i.state === "done")) navigate(`${app}/sources/${rid}`);
        return current;
      });
    },
  });
  const failed = items.filter((i) => i.state === "failed").length;
  const total = items.reduce((n, i) => n + i.file.size, 0);
  const loaded = items.reduce((n, i) => n + (i.state === "done" ? i.file.size : i.loaded), 0);
  const steps = ["What is it?", "Describe it", "Add files", "Create"];
  if (kinds.isPending) return <Loading />;
  if (kinds.isError) return <ErrorCallout error={kinds.error} />;
  return (
    <div className="stack-lg" style={{ maxWidth: "46rem" }}>
      <PageHeader crumbs={[{ label: "Sources", to: `${app}/sources` }, { label: "Add a source" }]} title="Add a source" description="Say what the material is; WhatBuild files it and parses it into passages your team and your agents can cite." />
      <ol className="stepper" aria-label="Steps">
        {steps.map((s, i) => (
          <li key={s} aria-current={i === step ? "step" : undefined} className={i < step ? "done" : ""}>
            {s}
          </li>
        ))}
      </ol>

      {step === 0 ? (
        <section className="stack" aria-labelledby="s0">
          <h2 id="s0">What is this?</h2>
          <p className="muted">Pick the closest match. It decides where the source is filed and which details to ask for.</p>
          <div className="kind-groups">
            {kinds.data.groups.map((g) => (
              <fieldset key={g.group} className="kind-group">
                <legend>
                  {g.label} <span className="faint small">— {g.description}</span>
                </legend>
                {kinds.data.kinds.filter((k) => k.group === g.group).map((k) => (
                  <label key={k.kind} className={`kind-option ${kind === k.kind ? "selected" : ""}`}>
                    <input type="radio" name="kind" value={k.kind} checked={kind === k.kind} onChange={() => setKind(k.kind)} />
                    <span>
                      <strong>{k.label}</strong>
                      <span className="small muted kind-desc">{k.description}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
            ))}
          </div>
          <div aria-live="polite">
            {info ? (
              <Callout tone="info">
                Filed under <strong>{destination(info, date)}</strong>.
                {info.recording ? " WhatBuild stores recordings without transcribing them; to search a transcript, add it as its own source." : ""}
              </Callout>
            ) : null}
          </div>
          <div className="row">
            <Button variant="primary" disabled={!kind} onClick={() => setStep(1)}>
              Continue
            </Button>
          </div>
        </section>
      ) : null}

      {step === 1 && info ? (
        <form
          className="stack"
          aria-labelledby="s1"
          onSubmit={(e) => {
            e.preventDefault();
            setTouched(true);
            if (describeOk) setStep(2);
          }}
        >
          <h2 id="s1">Describe it</h2>
          <TextField label="Title" hint="How the team refers to it: who, what, when. Not the file name." required maxLength={300} value={title} onChange={(e) => setTitle(e.target.value)} error={touched ? errors.title : null} autoFocus />
          <TextField label="Date" type="date" hint="When the interview or call happened, or the document is dated — not today." optional={!info.dated} value={date} onChange={(e) => setDate(e.target.value)} error={touched ? errors.date : null} />
          <TextField label="Organization" hint="The customer or organization the material concerns." optional={!info.organizational} value={organization} onChange={(e) => setOrganization(e.target.value)} error={touched ? errors.organization : null} />
          <TextField label="Tags" optional hint="Comma-separated. Domain terms belong here." value={tags} onChange={(e) => setTags(e.target.value)} />
          <details>
            <summary>More details</summary>
            <div className="stack" style={{ marginTop: "var(--space-3)" }}>
              <TextField label="Participants" optional hint="Comma-separated names or roles." value={participants} onChange={(e) => setParticipants(e.target.value)} />
              <TextField label="Where it came from" optional hint="A meeting tool, a wiki, a research tool." value={sourceSystem} onChange={(e) => setSourceSystem(e.target.value)} />
              <SelectField label="Relationship to the evidence" value={provenance} onChange={(e) => setProvenance(e.target.value)}>
                <option value="unknown">Not specified</option>
                <option value="primary">Primary source</option>
                <option value="derived">Derived material</option>
                <option value="analysis_of_analysis">Analysis of analysis</option>
              </SelectField>
            </div>
          </details>
          <div className="row">
            <Button onClick={() => setStep(0)}>Back</Button>
            <Button type="submit" variant="primary">
              Continue
            </Button>
          </div>
        </form>
      ) : null}

      {step === 2 ? (
        <section className="stack" aria-labelledby="s2">
          <h2 id="s2">Add files</h2>
          <p className="muted">The primary file is the source itself: WhatBuild parses it into passages and search covers it. {kinds.data.search_rule}</p>
          {primary ? (
            <div className="file-row">
              <span className="grow">
                <strong>{primary.file.name}</strong> <span className="small muted">· {formatBytes(primary.file.size)}</span>
              </span>
              <Badge tone="accent">Primary</Badge>
              <Button size="sm" variant="quiet" onClick={() => setItems(items.filter((i) => i !== primary))}>
                Remove
              </Button>
            </div>
          ) : (
            <DropZone
              label="Primary file (searched)"
              hint="VTT, SRT, text, Markdown, DOCX, XLSX, PDF or HTML parse into passages. Audio and video are stored and marked as needing a transcript."
              multiple={false}
              onFiles={(f) => f[0] && setItems([...items, { file: f[0], role: "primary", state: "waiting", loaded: 0 }])}
            />
          )}
          {primary && primary.file.size >= 10 * MiB && !RECORDING.test(primary.file.type) ? (
            <Callout tone="warning" title="Consider a digest">
              {primary.file.size > 25 * MiB
                ? "Over 25 MB, this file will be stored but not parsed or searched. "
                : "Large documents search poorly. "}
              Add a short digest of what bears on your questions as the primary, and attach this file as an origin.
            </Callout>
          ) : null}
          <DropZone label="Origin files (kept, not searched)" hint="The full originals behind a digest: kept in full for download and checking." multiple onFiles={(f) => setItems([...items, ...f.map((file) => ({ file, role: "origin" as const, state: "waiting" as const, loaded: 0 }))])} />
          <DropZone label="Supplements (kept, not searched)" hint="Slides for a call, an appendix, a screenshot." multiple onFiles={(f) => setItems([...items, ...f.map((file) => ({ file, role: "supplement" as const, state: "waiting" as const, loaded: 0 }))])} />
          {items.filter((i) => i.role !== "primary").map((i) => (
            <div key={`${i.role}:${i.file.name}`} className="file-row">
              <span className="grow">
                {i.file.name} <span className="small muted">· {formatBytes(i.file.size)}</span>
              </span>
              <Badge>{i.role === "origin" ? "Origin" : "Supplement"}</Badge>
              <Button size="sm" variant="quiet" onClick={() => setItems(items.filter((x) => x !== i))}>
                Remove
              </Button>
            </div>
          ))}
          <div className="row">
            <Button onClick={() => setStep(1)}>Back</Button>
            <Button variant="primary" onClick={() => setStep(3)}>
              {primary ? "Continue" : "Continue without a file"}
            </Button>
          </div>
        </section>
      ) : null}

      {step === 3 && info ? (
        <section className="stack" aria-labelledby="s3">
          <h2 id="s3">Create the source</h2>
          <dl className="summary">
            <dt>Kind</dt>
            <dd>{info.label}</dd>
            <dt>Title</dt>
            <dd>{title}</dd>
            <dt>Date</dt>
            <dd>{date || "No date"}</dd>
            <dt>Organization</dt>
            <dd>{organization || "—"}</dd>
            {tags ? (
              <>
                <dt>Tags</dt>
                <dd>{splitList(tags).join(", ")}</dd>
              </>
            ) : null}
            <dt>Filed under</dt>
            <dd>{destination(info, date)}</dd>
          </dl>
          {items.length ? (
            <ul className="upload-list" aria-live="polite">
              {items.map((i) => (
                <li key={`${i.role}:${i.file.name}`} className="file-row">
                  <span className="grow">
                    {i.file.name} <span className="small muted">· {formatBytes(i.file.size)} · {i.role}</span>
                    {i.error ? <div className="small" style={{ color: "var(--danger)" }}>{i.error}</div> : null}
                  </span>
                  <Badge tone={i.state === "done" ? "success" : i.state === "failed" ? "danger" : i.state === "uploading" ? "info" : "neutral"}>
                    {i.state === "uploading" ? `${Math.round((i.loaded / Math.max(1, i.file.size)) * 100)}%` : i.state === "done" ? "Uploaded" : i.state === "failed" ? "Failed" : "Ready"}
                  </Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No files: the source will hold metadata only until a file is added.</p>
          )}
          {run.isPending && total ? <progress max={total} value={loaded} aria-label="Upload progress" className="progress" /> : null}
          {run.isError ? <ErrorCallout title="The source could not be created" error={run.error} /> : null}
          {failed && !run.isPending ? (
            <Callout tone="warning" title={failed === 1 ? "One file did not upload" : `${failed} files did not upload`} action={<Button size="sm" onClick={() => navigate(`${app}/sources/${recordId}`)}>Open the source anyway</Button>}>
              The source exists. Retrying uploads only the failed files.
            </Callout>
          ) : null}
          <div className="row">
            {!recordId ? <Button onClick={() => setStep(2)}>Back</Button> : null}
            <Button variant="primary" busy={run.isPending} busyLabel={recordId ? "Uploading…" : "Creating…"} onClick={() => run.mutate()}>
              {failed ? "Retry failed files" : recordId ? "Try again" : "Create source"}
            </Button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
