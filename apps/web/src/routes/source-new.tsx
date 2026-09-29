import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { api, putWithProgress } from "../lib/api.ts";
import { formatBytes, formatDate, plural } from "../lib/format.ts";
import { useProduct } from "../lib/session.tsx";
import { ROLE_LABEL } from "../lib/status.ts";
import type { KindInfo } from "../lib/types.ts";
import { usePageTitle } from "../shell/slots.tsx";
import {
  Button, ButtonLink, Callout, ChoiceRow, EmptyState, ErrorCallout, FormGrid, Glyph, IconButton, KeyValue, Loading, PageHeader, SelectField, Sheet,
  SheetBody, SheetHeader, StatusBadge, TextField,
} from "../ui/index.tsx";
import { useKinds } from "./evidence.tsx";
import "../styles/screens/evidence.css";

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
      className={`intake-drop${over ? " intake-drop-over" : ""}`}
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
      <Glyph name="upload" className="intake-drop-icon" />
      <span className="intake-drop-text">
        <strong>{label}</strong>
        <span>{hint}</span>
      </span>
      <Button size="sm" onClick={() => input.current?.click()}>
        Choose {multiple ? "files" : "a file"}
      </Button>
      <input ref={input} type="file" hidden multiple={multiple} onChange={(e) => onFiles([...(e.target.files ?? [])])} />
    </div>
  );
}

function FileRow({ item, onRemove, status }: { item: Item; onRemove?: () => void; status?: boolean }) {
  return (
    <li className="intake-file">
      <Glyph name={RECORDING.test(item.file.type) ? "file-audio" : "file-text"} />
      <span className="intake-file-main">
        <b className="ellipsis">{item.file.name}</b>
        <span className="faint">
          {ROLE_LABEL[item.role]} · {item.role === "primary" ? "searched" : "kept, not searched"} · {formatBytes(item.file.size)}
        </span>
        {item.error ? <span className="field-error">{item.error}</span> : null}
      </span>
      {status ? (
        <StatusBadge tone={item.state === "done" ? "positive" : item.state === "failed" ? "negative" : item.state === "uploading" ? "progress" : "neutral"}>
          {item.state === "uploading" ? `${Math.round((item.loaded / Math.max(1, item.file.size)) * 100)}%` : item.state === "done" ? "Uploaded" : item.state === "failed" ? "Failed" : "Ready"}
        </StatusBadge>
      ) : null}
      {onRemove ? <IconButton size="sm" icon="x" label={`Remove ${item.file.name}`} onClick={onRemove} /> : null}
    </li>
  );
}

const STEPS = ["What is it?", "Describe it", "Add files", "Create"];

export function SourceNewPage() {
  const { api: base, app, canWrite } = useProduct();
  const kinds = useKinds();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  usePageTitle("Add a source");
  const [step, setStep] = useState(0);
  const [kind, setKind] = useState(params.get("kind") ?? "");
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
  const preset = useRef(params.get("kind"));
  const info = kinds.data?.kinds.find((k) => k.kind === kind);
  // Arriving from "Add source" with a kind already chosen goes straight to describing it.
  useEffect(() => {
    if (!preset.current || !kinds.data) return;
    if (kinds.data.kinds.some((k) => k.kind === preset.current)) setStep(1);
    else setKind("");
    preset.current = null;
  }, [kinds.data]);
  const errors = {
    title: !title.trim() ? "Say what this source is." : null,
    date: info?.dated && !date ? "This kind of source needs the date it was captured: when it happened, not today." : null,
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
      void qc.invalidateQueries({ queryKey: ["product"] });
      setItems((current) => {
        if (current.every((i) => i.state === "done")) navigate(`${app}/evidence/${rid}`);
        return current;
      });
    },
  });
  const failed = items.filter((i) => i.state === "failed").length;
  const total = items.reduce((n, i) => n + i.file.size, 0);
  const loaded = items.reduce((n, i) => n + (i.state === "done" ? i.file.size : i.loaded), 0);
  const header = <PageHeader crumbs={[{ label: "Evidence", to: `${app}/evidence` }, { label: "Add a source" }]} title="Add a source" meta={<span>Say what the material is. WhatBuild files it and parses it into passages your team and your agents can cite.</span>} />;
  if (!canWrite)
    return (
      <>
        {header}
        <EmptyState title="You can't add sources to this product." action={<ButtonLink to={`${app}/evidence`}>Back to Evidence</ButtonLink>}>
          Viewers can read and search sources. An admin of the product can make you an editor.
        </EmptyState>
      </>
    );
  if (kinds.isPending)
    return (
      <>
        {header}
        <Loading lines={6} />
      </>
    );
  if (kinds.isError)
    return (
      <>
        {header}
        <ErrorCallout error={kinds.error} onRetry={() => kinds.refetch()} />
      </>
    );
  return (
    <div className="intake">
      {header}
      <ol className="intake-steps" aria-label="Steps">
        {STEPS.map((s, i) => (
          <li key={s} aria-current={i === step ? "step" : undefined} className={i < step ? "intake-step-done" : undefined}>
            <span className="intake-step-n num" aria-hidden="true">
              {i < step ? <Glyph name="check" size="sm" /> : i + 1}
            </span>
            {s}
            {i < step ? <span className="visually-hidden"> (done)</span> : null}
          </li>
        ))}
      </ol>

      {step === 0 ? (
        <Sheet as="section" labelledBy="intake-h" className="intake-sheet">
          <SheetHeader id="intake-h" title="What is it?" end={<span className="faint small">It decides where the source is filed and what to ask for.</span>} />
          <div className="intake-kinds">
            {kinds.data.groups.map((g) => (
              <fieldset key={g.group} className="intake-kind-group">
                <legend>
                  {g.label} <span className="faint">{g.description}</span>
                </legend>
                <div className="intake-kind-grid">
                  {kinds.data.kinds
                    .filter((k) => k.group === g.group)
                    .map((k) => (
                      <ChoiceRow key={k.kind} type="radio" variant="boxed" name="kind" value={k.kind} checked={kind === k.kind} onChange={() => setKind(k.kind)} label={k.label} hint={k.description} />
                    ))}
                </div>
              </fieldset>
            ))}
          </div>
          <div className="intake-foot">
            <span className="intake-foot-note" aria-live="polite">
              {info ? (
                <>
                  Filed under <strong>{destination(info, date)}</strong>.{info.recording ? " WhatBuild stores recordings without transcribing them; to search a transcript, add it as its own source." : ""}
                </>
              ) : (
                "Pick the closest match."
              )}
            </span>
            <ButtonLink to={`${app}/evidence`} variant="quiet">
              Cancel
            </ButtonLink>
            <Button variant="primary" disabled={!kind} onClick={() => setStep(1)}>
              Continue
            </Button>
          </div>
        </Sheet>
      ) : null}

      {step === 1 && info ? (
        <Sheet
          as="form"
          labelledBy="intake-h"
          className="intake-sheet"
        >
          <SheetHeader id="intake-h" title="Describe it" end={<span className="faint small">{info.label}</span>} />
          <DescribeForm
            info={info}
            touched={touched}
            errors={errors}
            fields={{ title, date, organization, tags, participants, sourceSystem, provenance }}
            set={{ title: setTitle, date: setDate, organization: setOrganization, tags: setTags, participants: setParticipants, sourceSystem: setSourceSystem, provenance: setProvenance }}
          />
          <div className="intake-foot">
            <span className="intake-foot-note">
              Filed under <strong>{destination(info, date)}</strong>.
            </span>
            <Button onClick={() => setStep(0)}>Back</Button>
            <Button
              type="submit"
              variant="primary"
              onClick={(e) => {
                e.preventDefault();
                setTouched(true);
                if (describeOk) setStep(2);
              }}
            >
              Continue
            </Button>
          </div>
        </Sheet>
      ) : null}

      {step === 2 ? (
        <Sheet as="section" labelledBy="intake-h" className="intake-sheet">
          <SheetHeader id="intake-h" title="Add files" end={<span className="faint small">Optional. You or your agent can add them later.</span>} />
          <SheetBody>
            <p className="muted">The primary file is the source itself: WhatBuild parses it into passages and search covers it. {kinds.data.search_rule}</p>
          </SheetBody>
          <div className="intake-files">
            {primary ? (
              <ul className="intake-file-list">
                <FileRow item={primary} onRemove={() => setItems(items.filter((i) => i !== primary))} />
              </ul>
            ) : (
              <DropZone
                label="Primary file: searched"
                hint="VTT, SRT, text, Markdown, DOCX, XLSX, PDF or HTML parse into passages. Audio and video are stored and marked as needing a transcript."
                multiple={false}
                onFiles={(f) => f[0] && setItems([...items, { file: f[0], role: "primary", state: "waiting", loaded: 0 }])}
              />
            )}
            {primary && primary.file.size >= 10 * MiB && !RECORDING.test(primary.file.type) ? (
              <Callout inset tone="attention" title="Consider a digest">
                {primary.file.size > 25 * MiB ? "Over 25 MB, this file will be stored but not parsed or searched. " : "Large documents search poorly. "}
                Add a short digest of what bears on your questions as the primary, and attach this file as an origin.
              </Callout>
            ) : null}
            <DropZone label="Origin files: kept, not searched" hint="The full originals behind a digest, kept in full for download and checking." multiple onFiles={(f) => setItems([...items, ...f.map((file) => ({ file, role: "origin" as const, state: "waiting" as const, loaded: 0 }))])} />
            <DropZone label="Supplements: kept, not searched" hint="Slides for a call, an appendix, a screenshot." multiple onFiles={(f) => setItems([...items, ...f.map((file) => ({ file, role: "supplement" as const, state: "waiting" as const, loaded: 0 }))])} />
            {items.some((i) => i.role !== "primary") ? (
              <ul className="intake-file-list">
                {items
                  .filter((i) => i.role !== "primary")
                  .map((i) => (
                    <FileRow key={`${i.role}:${i.file.name}`} item={i} onRemove={() => setItems(items.filter((x) => x !== i))} />
                  ))}
              </ul>
            ) : null}
          </div>
          <div className="intake-foot">
            <span className="intake-foot-note">{items.length ? plural(items.length, "file") + ", " + formatBytes(total) : "No files yet."}</span>
            <Button onClick={() => setStep(1)}>Back</Button>
            <Button variant="primary" onClick={() => setStep(3)}>
              {items.length ? "Continue" : "Continue without a file"}
            </Button>
          </div>
        </Sheet>
      ) : null}

      {step === 3 && info ? (
        <Sheet as="section" labelledBy="intake-h" className="intake-sheet">
          <SheetHeader id="intake-h" title="Create the source" />
          <SheetBody>
            <KeyValue
              items={[
                { label: "Kind", value: info.label },
                { label: "Title", value: title },
                { label: "Captured", value: date ? formatDate(date) : "No date" },
                { label: "Organization", value: organization || null },
                { label: "Tags", value: tags ? splitList(tags).join(", ") : null },
                { label: "Filed under", value: destination(info, date) },
              ]}
            />
          </SheetBody>
          {items.length ? (
            <ul className="intake-file-list intake-file-list-sheet" aria-live="polite">
              {items.map((i) => (
                <FileRow key={`${i.role}:${i.file.name}`} item={i} status />
              ))}
            </ul>
          ) : (
            <SheetBody>
              <p className="muted">No files: the source holds metadata only until a file is added.</p>
            </SheetBody>
          )}
          {run.isPending && total ? (
            <SheetBody>
              <progress max={total} value={loaded} aria-label="Upload progress" className="intake-progress" />
            </SheetBody>
          ) : null}
          {run.isError || (failed && !run.isPending) ? (
            <SheetBody>
              {run.isError ? <ErrorCallout inset title="The source could not be created" error={run.error} /> : null}
              {failed && !run.isPending ? (
                <Callout
                  inset
                  tone="attention"
                  title={failed === 1 ? "One file did not upload" : `${failed} files did not upload`}
                  action={
                    <Button size="sm" onClick={() => navigate(`${app}/evidence/${recordId}`)}>
                      Open the source anyway
                    </Button>
                  }
                >
                  The source exists. Retrying uploads only the failed files.
                </Callout>
              ) : null}
            </SheetBody>
          ) : null}
          <div className="intake-foot">
            <span className="intake-foot-note" />
            {!recordId ? (
              <Button onClick={() => setStep(2)} disabled={run.isPending}>
                Back
              </Button>
            ) : null}
            <Button variant="primary" busy={run.isPending} busyLabel={recordId ? "Uploading…" : "Creating…"} onClick={() => run.mutate()}>
              {failed ? "Retry failed files" : recordId ? "Try again" : "Create source"}
            </Button>
          </div>
        </Sheet>
      ) : null}
    </div>
  );
}

type Fields = { title: string; date: string; organization: string; tags: string; participants: string; sourceSystem: string; provenance: string };

function DescribeForm({ info, touched, errors, fields: v, set }: {
  info: KindInfo;
  touched: boolean;
  errors: { title: string | null; date: string | null; organization: string | null };
  fields: Fields;
  set: { [K in keyof Fields]: (value: string) => void };
}) {
  const [more, setMore] = useState(Boolean(v.participants || v.sourceSystem || v.provenance !== "unknown"));
  return (
    <div className="intake-describe">
      <FormGrid>
        <TextField label="Title" hint="How the team refers to it: who, what, when. Not the file name." required maxLength={300} value={v.title} onChange={(e) => set.title(e.target.value)} error={touched ? errors.title : null} autoFocus />
        <TextField label="Date captured" type="date" hint="When the interview or call happened, or the document is dated. Not today." optional={!info.dated} value={v.date} onChange={(e) => set.date(e.target.value)} error={touched ? errors.date : null} />
        <TextField label="Organization" hint="The customer or organization the material concerns." optional={!info.organizational} value={v.organization} onChange={(e) => set.organization(e.target.value)} error={touched ? errors.organization : null} />
        <TextField label="Tags" optional hint="Comma-separated. Domain terms belong here." value={v.tags} onChange={(e) => set.tags(e.target.value)} />
        {more ? (
          <>
            <TextField label="Participants" optional hint="Comma-separated names or roles." value={v.participants} onChange={(e) => set.participants(e.target.value)} />
            <TextField label="Where it came from" optional hint="A meeting tool, a wiki, a research tool." value={v.sourceSystem} onChange={(e) => set.sourceSystem(e.target.value)} />
            <SelectField label="Relationship to the evidence" value={v.provenance} onChange={(e) => set.provenance(e.target.value)}>
              <option value="unknown">Not specified</option>
              <option value="primary">Primary source</option>
              <option value="derived">Derived material</option>
              <option value="analysis_of_analysis">Analysis of analysis</option>
            </SelectField>
          </>
        ) : null}
      </FormGrid>
      {!more ? (
        <div className="intake-more">
          <Button size="sm" variant="quiet" icon="plus" onClick={() => setMore(true)}>
            Participants, origin and relationship
          </Button>
        </div>
      ) : null}
    </div>
  );
}
