import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useNavigate } from "react-router";
import { api, putWithProgress } from "../lib/api.ts";
import { formatBytes, formatDate, plural } from "../lib/format.ts";
import { useProduct } from "../lib/session.tsx";
import { ROLE_LABEL } from "../lib/status.ts";
import { usePageTitle } from "../shell/slots.tsx";
import {
  Button, ButtonLink, Callout, EmptyState, ErrorCallout, FormGrid, Glyph, IconButton, KeyValue, PageHeader, SelectField, Sheet, SheetBody, SheetHeader,
  StatusBadge, TextField,
} from "../ui/index.tsx";
import { splitTags, TagSuggestions } from "./evidence.tsx";
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

/**
 * Upload files to a source one after another, primary first, through grants — the same path agents use.
 * Resolves true when every file is in, so callers move on without reading state inside an updater.
 */
export async function uploadFiles(base: string, recordId: string, items: Item[], update: (i: number, patch: Partial<Item>) => void): Promise<boolean> {
  let allDone = true;
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
      allDone = false;
    }
  }
  return allDone;
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

const STEPS = ["Describe it", "Add files", "Create"];

export function SourceNewPage() {
  const { api: base, app, canWrite } = useProduct();
  const navigate = useNavigate();
  const qc = useQueryClient();
  usePageTitle("Add a source");
  const [step, setStep] = useState(0);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [tags, setTags] = useState("");
  const [participants, setParticipants] = useState("");
  const [sourceSystem, setSourceSystem] = useState("");
  const [provenance, setProvenance] = useState("unknown");
  const [touched, setTouched] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [recordId, setRecordId] = useState<string | null>(null);
  const errors = { title: !title.trim() ? "Give the source a title." : null };
  const describeOk = !errors.title;
  const primary = items.find((i) => i.role === "primary");
  const update = (i: number, patch: Partial<Item>) => setItems((all) => all.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const run = useMutation({
    mutationFn: async () => {
      let rid = recordId;
      if (!rid) {
        const r = await api<{ record_id: string }>("POST", `${base}/sources`, {
          title: title.trim(),
          date: date || null,
          tags: splitTags(tags),
          participants: splitTags(participants),
          source_system: sourceSystem.trim() || null,
          provenance_depth: provenance,
        });
        rid = r.record_id;
        setRecordId(rid);
      }
      const allDone = await uploadFiles(base, rid, items, update);
      return { rid, allDone };
    },
    onSuccess: async ({ rid, allDone }) => {
      await qc.invalidateQueries({ queryKey: ["sources", base] });
      void qc.invalidateQueries({ queryKey: ["product"] });
      // Navigating from inside a state updater updates the router while this page renders.
      if (allDone) navigate(`${app}/evidence/${rid}`);
    },
  });
  const failed = items.filter((i) => i.state === "failed").length;
  const total = items.reduce((n, i) => n + i.file.size, 0);
  const loaded = items.reduce((n, i) => n + (i.state === "done" ? i.file.size : i.loaded), 0);
  const header = <PageHeader crumbs={[{ label: "Evidence", to: `${app}/evidence` }, { label: "Add a source" }]} title="Add a source" />;
  if (!canWrite)
    return (
      <>
        {header}
        <EmptyState title="You can’t add sources to this product" action={<ButtonLink to={`${app}/evidence`}>Back to Evidence</ButtonLink>}>
          An admin of this product can make you an editor.
        </EmptyState>
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
        <Sheet
          as="form"
          labelledBy="intake-h"
          className="intake-sheet"
        >
          <SheetHeader id="intake-h" title="Describe it" />
          <DescribeForm
            touched={touched}
            errors={errors}
            fields={{ title, date, tags, participants, sourceSystem, provenance }}
            set={{ title: setTitle, date: setDate, tags: setTags, participants: setParticipants, sourceSystem: setSourceSystem, provenance: setProvenance }}
          />
          <div className="intake-foot">
            <span className="intake-foot-note" />
            <ButtonLink to={`${app}/evidence`} variant="quiet">
              Cancel
            </ButtonLink>
            <Button
              type="submit"
              variant="primary"
              onClick={(e) => {
                e.preventDefault();
                setTouched(true);
                if (describeOk) setStep(1);
              }}
            >
              Continue
            </Button>
          </div>
        </Sheet>
      ) : null}

      {step === 1 ? (
        <Sheet as="section" labelledBy="intake-h" className="intake-sheet">
          <SheetHeader id="intake-h" title="Add files" end={<span className="faint small">Optional. You can add them later.</span>} />
          <div className="intake-files">
            {primary ? (
              <ul className="intake-file-list">
                <FileRow item={primary} onRemove={() => setItems(items.filter((i) => i !== primary))} />
              </ul>
            ) : (
              <DropZone
                label="Primary file: searched"
                hint="VTT, SRT, text, Markdown, DOC, DOCX, XLSX, CSV, TSV, PDF or HTML. Images, audio and video aren’t searched; to search a recording, add its transcript as its own source."
                multiple={false}
                onFiles={(f) => f[0] && setItems([...items, { file: f[0], role: "primary", state: "waiting", loaded: 0 }])}
              />
            )}
            {primary && primary.file.size >= 10 * MiB && !RECORDING.test(primary.file.type) ? (
              <Callout inset tone="attention" title="Consider a digest">
                {primary.file.size > 25 * MiB ? "Files over 25 MB are kept but not searched. " : "Large documents search poorly. "}
                Add a short digest as the primary file and attach this one as an origin.
              </Callout>
            ) : null}
            <DropZone label="Origin files: kept, not searched" hint="The full originals behind a digest." multiple onFiles={(f) => setItems([...items, ...f.map((file) => ({ file, role: "origin" as const, state: "waiting" as const, loaded: 0 }))])} />
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
            <Button onClick={() => setStep(0)}>Back</Button>
            <Button variant="primary" onClick={() => setStep(2)}>
              {items.length ? "Continue" : "Continue without a file"}
            </Button>
          </div>
        </Sheet>
      ) : null}

      {step === 2 ? (
        <Sheet as="section" labelledBy="intake-h" className="intake-sheet">
          <SheetHeader id="intake-h" title="Create the source" />
          <SheetBody>
            <KeyValue
              items={[
                { label: "Title", value: title },
                { label: "Captured", value: date ? formatDate(date) : "No date" },
                { label: "Tags", value: tags ? splitTags(tags).join(", ") : null },
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
              <p className="muted">No files yet.</p>
            </SheetBody>
          )}
          {run.isPending && total ? (
            <SheetBody>
              <progress max={total} value={loaded} aria-label="Upload progress" className="intake-progress" />
            </SheetBody>
          ) : null}
          {run.isError || (failed && !run.isPending) ? (
            <SheetBody>
              {run.isError ? <ErrorCallout inset title="The source couldn’t be created" error={run.error} /> : null}
              {failed && !run.isPending ? (
                <Callout
                  inset
                  tone="attention"
                  title={failed === 1 ? "One file didn’t upload" : `${failed} files didn’t upload`}
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
              <Button onClick={() => setStep(1)} disabled={run.isPending}>
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

type Fields = { title: string; date: string; tags: string; participants: string; sourceSystem: string; provenance: string };

function DescribeForm({ touched, errors, fields: v, set }: {
  touched: boolean;
  errors: { title: string | null };
  fields: Fields;
  set: { [K in keyof Fields]: (value: string) => void };
}) {
  const [more, setMore] = useState(Boolean(v.participants || v.sourceSystem || v.provenance !== "unknown"));
  return (
    <div className="intake-describe">
      <FormGrid>
        <TextField label="Title" required maxLength={300} value={v.title} onChange={(e) => set.title(e.target.value)} error={touched ? errors.title : null} autoFocus />
        <TextField label="Date captured" type="date" hint="When the meeting happened or the document is dated, not today." optional value={v.date} onChange={(e) => set.date(e.target.value)} />
        <TextField label="Tags" optional hint="Comma-separated: what it is, whom it concerns, what it bears on." value={v.tags} onChange={(e) => set.tags(e.target.value)} />
        <TagSuggestions value={v.tags} onChange={set.tags} />
        {more ? (
          <>
            <TextField label="Participants" optional hint="Comma-separated names or roles." value={v.participants} onChange={(e) => set.participants(e.target.value)} />
            <TextField label="Where it came from" optional hint="For example, a meeting tool or a wiki." value={v.sourceSystem} onChange={(e) => set.sourceSystem(e.target.value)} />
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
