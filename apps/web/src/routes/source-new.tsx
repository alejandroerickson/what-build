import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useNavigate } from "react-router";
import { api, putWithProgress } from "../lib/api.ts";
import { formatBytes, formatDate, plural } from "../lib/format.ts";
import { useProduct } from "../lib/session.tsx";
import { usePageTitle } from "../shell/slots.tsx";
import {
  Button, ButtonLink, Callout, EmptyState, ErrorCallout, FormGrid, Glyph, IconButton, KeyValue, PageHeader, Sheet, SheetBody, SheetHeader,
  StatusBadge, TextField,
} from "../ui/index.tsx";
import { splitTags, TagSuggestions } from "./evidence.tsx";
import "../styles/screens/evidence.css";

/** A file on its way to a source as an attachment. */
export interface UploadItem {
  file: File;
  state: "waiting" | "uploading" | "done" | "failed";
  loaded: number;
  error?: string | undefined;
}
type Item = UploadItem;

const RECORDING = /^(audio|video)\//;

/**
 * Upload files to a source as attachments, one after another in the order given, through grants —
 * the same path agents use. Resolves true when every file is in, so callers move on without reading
 * state inside an updater.
 */
export async function uploadFiles(base: string, recordId: string, items: Item[], update: (i: number, patch: Partial<Item>) => void): Promise<boolean> {
  let allDone = true;
  for (const [i, it] of items.entries()) {
    if (it.state === "done") continue;
    update(i, { state: "uploading", loaded: 0, error: undefined });
    try {
      const grant = await api<{ url: string; headers: Record<string, string>; max_bytes: number }>("POST", `${base}/sources/${recordId}/uploads`, {
        path: it.file.name,
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
        <span className="faint">{formatBytes(item.file.size)}</span>
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

const STEPS = ["Describe it", "Add attachments", "Create"];

export function SourceNewPage() {
  const { api: base, app, canWrite } = useProduct();
  const navigate = useNavigate();
  const qc = useQueryClient();
  usePageTitle("Add a source");
  const [step, setStep] = useState(0);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [tags, setTags] = useState("");
  const [touched, setTouched] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [recordId, setRecordId] = useState<string | null>(null);
  const errors = { title: !title.trim() ? "Give the source a title." : null };
  const describeOk = !errors.title;
  const update = (i: number, patch: Partial<Item>) => setItems((all) => all.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const run = useMutation({
    mutationFn: async () => {
      let rid = recordId;
      if (!rid) {
        const r = await api<{ record_id: string }>("POST", `${base}/sources`, {
          title: title.trim(),
          date: date || null,
          tags: splitTags(tags),
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
            fields={{ title, date, tags }}
            set={{ title: setTitle, date: setDate, tags: setTags }}
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
          <SheetHeader id="intake-h" title="Add attachments" end={<span className="faint small">Optional. You can add them later.</span>} />
          <div className="intake-files">
            <DropZone
              label="Attachments"
              hint="They’re read in the order listed, and the first in which WhatBuild finds text becomes the source’s text, which search reads. It reads text, Markdown, transcripts (VTT, SRT), Word, PDF, spreadsheets and HTML, but no words in images or scanned pages, and it doesn’t transcribe recordings: add a recording’s transcript too."
              multiple
              onFiles={(f) => setItems([...items, ...f.filter((file) => !items.some((i) => i.file.name === file.name)).map((file) => ({ file, state: "waiting" as const, loaded: 0 }))])}
            />
            {items.length ? (
              <ul className="intake-file-list">
                {items.map((i) => (
                  <FileRow key={i.file.name} item={i} onRemove={() => setItems(items.filter((x) => x !== i))} />
                ))}
              </ul>
            ) : null}
          </div>
          <div className="intake-foot">
            <span className="intake-foot-note">{items.length ? plural(items.length, "attachment") + ", " + formatBytes(total) : "No attachments yet."}</span>
            <Button onClick={() => setStep(0)}>Back</Button>
            <Button variant="primary" onClick={() => setStep(2)}>
              {items.length ? "Continue" : "Continue without attachments"}
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
                <FileRow key={i.file.name} item={i} status />
              ))}
            </ul>
          ) : (
            <SheetBody>
              <p className="muted">No attachments yet.</p>
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

type Fields = { title: string; date: string; tags: string };

function DescribeForm({ touched, errors, fields: v, set }: {
  touched: boolean;
  errors: { title: string | null };
  fields: Fields;
  set: { [K in keyof Fields]: (value: string) => void };
}) {
  return (
    <div className="intake-describe">
      <FormGrid>
        <TextField label="Title" required maxLength={300} value={v.title} onChange={(e) => set.title(e.target.value)} error={touched ? errors.title : null} autoFocus />
        <TextField label="Date captured" type="date" hint="When the meeting happened or the document is dated, not today." optional value={v.date} onChange={(e) => set.date(e.target.value)} />
        <TextField label="Tags" optional hint="Comma-separated: what it is, whom it concerns, what it bears on." value={v.tags} onChange={(e) => set.tags(e.target.value)} />
        <TagSuggestions value={v.tags} onChange={set.tags} />
      </FormGrid>
    </div>
  );
}
