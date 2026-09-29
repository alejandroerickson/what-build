import { useState, type ReactNode } from "react";
import { ApiError } from "../lib/api.ts";
import { Inspector, InspectorToggle, PanelContext, PanelSection, usePageTitle } from "../shell/slots.tsx";
import { useTheme, type ThemeChoice } from "../shell/theme.ts";
import {
  AgentFace, Avatar, Button, ButtonLink, Callout, Chip, ChoiceRow, CopyField, Crumbs, Dialog, EmptyState, ErrorCallout, FindField, FormGrid, Glyph,
  Group, IconButton, KeyValue, ListRow, Loading, Menu, MenuCheckbox, MenuGroup, MenuItem, MenuLabel, MenuNote, MenuRadio, MenuSeparator, PageHeader,
  Segmented, SelectField, Sheet, SheetBody, SheetHeader, StatusBadge, Tag, TextArea, TextField, useToast,
} from "../ui/index.tsx";
import "./system.css";

/**
 * The living specimen of the design system: every token and primitive, in the light and the dark
 * theme side by side. Development builds only (see main.tsx); it is the screenshot target for reviews.
 */
export function SystemPage() {
  usePageTitle("Design system");
  const [theme, setTheme] = useTheme();
  const [inspector, setInspector] = useState("on");
  return (
    <div className="system">
      <PageHeader
        crumbs={[{ label: "WhatBuild", to: "/products" }, { label: "Development" }, { label: "Design system" }]}
        title="Design system"
        meta={<span>Every token and primitive, in both themes. Development builds only.</span>}
        actions={
          <>
            <Segmented label="Page theme" value={theme} onChange={(v) => setTheme(v as ThemeChoice)} items={[{ id: "light", label: "Light" }, { id: "dark", label: "Dark" }, { id: "system", label: "System" }]} />
            <Segmented label="Inspector" value={inspector} onChange={setInspector} items={[{ id: "on", label: "Inspector" }, { id: "off", label: "None" }]} />
            <InspectorToggle />
          </>
        }
      />
      <PanelContext label="Specimen filters">
        <SpecimenPanel />
      </PanelContext>
      {inspector === "on" ? <SpecimenInspector /> : null}
      <div className="system-bands">
        <section className="system-band theme-light" aria-label="Light theme">
          <h2 className="system-band-title">Light</h2>
          <Specimen />
        </section>
        <section className="system-band theme-dark" aria-label="Dark theme">
          <h2 className="system-band-title">Dark</h2>
          <Specimen />
        </section>
      </div>
    </div>
  );
}

function SpecimenPanel() {
  const [q, setQ] = useState("");
  const [kinds, setKinds] = useState<Record<string, boolean>>({ interview: true });
  return (
    <>
      <div className="system-panel-find">
        <FindField label="Find a filter" value={q} onChange={(e) => setQ(e.target.value)} />
        <IconButton label="Add a filter" icon="plus" />
      </div>
      <PanelSection title="Kind" end={<button type="button" className="panel-text-button" onClick={() => setKinds({})}>Clear filters</button>}>
        {[
          ["interview", "Interview", 2],
          ["call", "Call notes", 1],
          ["survey", "Survey export", 1],
        ].map(([id, label, n]) => (
          <ChoiceRow key={id as string} label={label} count={n} checked={Boolean(kinds[id as string])} onChange={(e) => setKinds({ ...kinds, [id as string]: e.target.checked })} />
        ))}
      </PanelSection>
      <PanelSection title="Archived">
        <ChoiceRow label="Show archived" count={0} disabled />
      </PanelSection>
    </>
  );
}

function SpecimenInspector() {
  return (
    <Inspector
      title="S-01 · Crew lead interview, Greenline Landscaping"
      actions={
        <Menu label="Source actions" triggerClassName="icon-btn icon-btn-md" trigger={<Glyph name="ellipsis" />}>
          <MenuLabel>S-01</MenuLabel>
          <MenuItem icon="download">Download original</MenuItem>
          <MenuItem icon="archive" meta="Reversible">
            Archive
          </MenuItem>
        </Menu>
      }
    >
      <Group title="Details">
        <KeyValue
          items={[
            { label: "Kind", value: "Interview transcript" },
            { label: "Date", value: "14 Aug 2026" },
            { label: "Added", value: <span className="system-face"><AgentFace /><span>Claude Code for Sam<small>via claude-code · Sep 8</small></span></span> },
            { label: "Status", value: <Menu triggerClassName="field-button" label="Status" trigger={<><StatusBadge tone="positive">Ready</StatusBadge><Glyph name="chevron-down" size="sm" /></>}><MenuRadio checked onSelect={() => {}}>Ready</MenuRadio></Menu> },
          ]}
        />
      </Group>
      <Group title="Files" count={3}>
        <ul className="system-files">
          <li><Glyph name="file-text" /><span><b>Transcript</b><StatusBadge tone="positive">Searched</StatusBadge></span></li>
          <li><Glyph name="file-audio" /><span><b>Audio recording</b><span className="faint">Kept, not searched</span></span></li>
        </ul>
      </Group>
      <Group title="Cited in" count={2}>
        <div className="chips">
          <Chip to="/_system" icon="lightbulb">I-1 Planning is a weekly ritual</Chip>
          <Chip icon="scale">A-2</Chip>
        </div>
      </Group>
      <Group title="Empty group">
        <EmptyState size="inline">Not cited anywhere yet.</EmptyState>
      </Group>
    </Inspector>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="system-row">
      <div className="system-row-label">{label}</div>
      <div className="system-row-body">{children}</div>
    </div>
  );
}

const SURFACES = ["canvas", "panel", "popover", "hover", "hover-strong", "select", "line", "line-2", "line-strong"];
const INKS = ["text", "muted", "faint", "select-text", "accent", "accent-text", "ok", "warn", "bad"];
const TYPE: [string, string][] = [
  ["fs-h1", "Item title, 20/600"],
  ["fs-lead", "Summary above prose, 15"],
  ["fs-title", "Sheet title, 14/600"],
  ["fs-prose", "Long-form Markdown, 13.5"],
  ["fs-body", "Passage text, 13"],
  ["fs-md", "Product name, 12.5/600"],
  ["fs-base", "The UI, 12"],
  ["fs-sm", "Secondary meta, 11.5"],
  ["fs-xs", "Counts and labels, 11"],
];
const SPACE = ["s-0", "s-1", "s-1h", "s-2", "s-2h", "s-3", "s-3h", "s-4", "s-5", "s-6", "s-7", "s-10", "s-12"];

function Specimen() {
  const toast = useToast();
  const [dialog, setDialog] = useState(false);
  const [seg, setSeg] = useState("all");
  const [check, setCheck] = useState(true);
  const [radio, setRadio] = useState("page");
  const [menuTheme, setMenuTheme] = useState("system");
  const [menuCheck, setMenuCheck] = useState(true);
  return (
    <div className="system-specimen">
      <Sheet>
        <SheetHeader title="Colour" />
        <SheetBody>
          <Row label="Surfaces">
            <div className="system-swatches">
              {SURFACES.map((t) => (
                <div key={t} className="system-swatch">
                  <span className="system-chip" style={{ background: `var(--${t})` }} />
                  <code>--{t}</code>
                </div>
              ))}
            </div>
          </Row>
          <Row label="Ink">
            <div className="system-swatches">
              {INKS.map((t) => (
                <div key={t} className="system-swatch">
                  <span className="system-chip" style={{ background: `var(--${t})` }} />
                  <code>--{t}</code>
                </div>
              ))}
            </div>
          </Row>
          <Row label="Depth">
            <div className="system-depths">
              <span style={{ boxShadow: "var(--shadow)" }}>--shadow</span>
              <span style={{ boxShadow: "var(--shadow-2)" }}>--shadow-2</span>
              <span style={{ boxShadow: "var(--shadow-paper)" }}>--shadow-paper</span>
            </div>
          </Row>
        </SheetBody>
      </Sheet>

      <Sheet>
        <SheetHeader title="Type, space, shape" />
        <SheetBody>
          <Row label="Type">
            <div className="system-type">
              {TYPE.map(([t, note]) => (
                <div key={t} style={{ fontSize: `var(--${t})` }}>
                  {note} <code>--{t}</code>
                </div>
              ))}
              <div className="num">Tabular 0123456789 · S-01 ¶8–10</div>
              <code>npx whatbuild connect --product crewboard</code>
            </div>
          </Row>
          <Row label="Space">
            <div className="system-space">
              {SPACE.map((t) => (
                <div key={t}>
                  <span style={{ width: `var(--${t})` }} />
                  <code>--{t}</code>
                </div>
              ))}
            </div>
          </Row>
          <Row label="Radius">
            <div className="system-radii">
              {["r-xs", "r-sm", "r-md", "r-lg"].map((t) => (
                <span key={t} style={{ borderRadius: `var(--${t})` }}>
                  --{t}
                </span>
              ))}
            </div>
          </Row>
        </SheetBody>
      </Sheet>

      <Sheet>
        <SheetHeader title="Buttons" />
        <SheetBody>
          <Row label="Variants, 28">
            <div className="row">
              <Button variant="primary" icon="plus">Add source</Button>
              <Button icon="download">Download</Button>
              <Button variant="quiet">Cancel</Button>
              <Button variant="danger" icon="trash">Delete permanently</Button>
            </div>
          </Row>
          <Row label="Compact, 24">
            <div className="row">
              <Button size="sm" variant="primary">Save</Button>
              <Button size="sm">Try again</Button>
              <Button size="sm" variant="quiet" icon="panel-right">Details</Button>
              <ButtonLink size="sm" to="/_system">A link as a button</ButtonLink>
            </div>
          </Row>
          <Row label="Busy, disabled">
            <div className="row">
              <Button variant="primary" busy busyLabel="Saving…">Save</Button>
              <Button busy>Loading</Button>
              <Button variant="primary" disabled>Publish</Button>
              <Button disabled icon="archive">Archive</Button>
            </div>
          </Row>
          <Row label="Icon buttons">
            <div className="row">
              <IconButton label="Hide panel" icon="panel-left-close" />
              <IconButton label="Add page" icon="plus" />
              <IconButton label="Page actions" icon="ellipsis" size="sm" />
              <IconButton label="Close" icon="x" disabled />
            </div>
          </Row>
        </SheetBody>
      </Sheet>

      <Sheet as="form" label="Fields">
        <SheetHeader title="Fields" />
        <SheetBody>
          <FormGrid>
            <TextField label="Product name" defaultValue="Crewboard" hint="Shown in the panel and in links." />
            <TextField label="Slug" defaultValue="crewboard" readOnly hint="Read-only: set when the product was made." />
            <TextField label="Organization" optional placeholder="Greenline Landscaping" />
            <TextField label="Date" defaultValue="2026-13-40" error="Use a real date, like 2026-08-14." />
            <TextField label="Team" defaultValue="Product team" disabled />
            <SelectField label="Kind" defaultValue="interview">
              <option value="interview">Interview transcript</option>
              <option value="notes">Interviewer notes</option>
            </SelectField>
            <TextArea label="Product concept" defaultValue="Crew leads spend a Friday afternoon building next week." />
          </FormGrid>
        </SheetBody>
      </Sheet>

      <Sheet>
        <SheetHeader title="Choices, search, menus" />
        <SheetBody>
          <Row label="Find">
            <div className="system-find">
              <FindField label="Search this source" />
            </div>
          </Row>
          <Row label="Choice rows">
            <div className="system-choices">
              <ChoiceRow label="Interview" count={2} checked={check} onChange={(e) => setCheck(e.target.checked)} />
              <ChoiceRow label="Call notes" count={1} />
              <ChoiceRow label="Archived" count={0} disabled />
              <ChoiceRow type="radio" variant="boxed" name={`scope-${seg}`} label="This page" count="1 page" checked={radio === "page"} onChange={() => setRadio("page")} />
              <ChoiceRow type="radio" variant="boxed" name={`scope-${seg}`} label="This page and its subpages" count="7 pages" checked={radio === "sub"} onChange={() => setRadio("sub")} />
            </div>
          </Row>
          <Row label="Segmented">
            <div className="stack-sm">
              <Segmented label="Review" value={seg} onChange={setSeg} items={[{ id: "all", label: "All", count: 3 }, { id: "unreviewed", label: "Unreviewed", count: 2 }, { id: "reviewed", label: "Reviewed" }]} />
              <Segmented label="Source view" value="passages" items={[{ id: "passages", label: "Passages", to: "/_system" }, { id: "original", label: "Original", to: "/_system?view=original" }, { id: "notes", label: "Notes", to: "/_system?view=notes" }, { id: "files", label: "Files", to: "/_system?view=files" }]} />
              <div className="system-equal">
                <Segmented equal label="Who" value="people" items={[{ id: "all", label: "All" }, { id: "people", label: "People" }, { id: "agents", label: "Agents" }]} onChange={() => {}} />
              </div>
            </div>
          </Row>
          <Row label="Menu">
            <div className="row">
              <Menu label="Page actions" triggerClassName="btn btn-secondary btn-md" align="start" trigger={<><Glyph name="ellipsis" />Page actions</>}>
                <MenuLabel>Where discovery stands</MenuLabel>
                <MenuItem icon="pencil" kbd="F2">Rename</MenuItem>
                <MenuItem icon="corner-down-right">Add child page</MenuItem>
                <MenuItem icon="folder-input">Move to…</MenuItem>
                <MenuItem icon="link" disabled>Copy link</MenuItem>
                <MenuSeparator />
                <MenuGroup label="Theme">
                  {["light", "dark", "system"].map((t) => (
                    <MenuRadio key={t} checked={menuTheme === t} onSelect={() => setMenuTheme(t)} keepOpen>
                      {t[0]!.toUpperCase() + t.slice(1)}
                    </MenuRadio>
                  ))}
                </MenuGroup>
                <MenuCheckbox checked={menuCheck} onChange={setMenuCheck} meta="3 people">Product team</MenuCheckbox>
                <MenuSeparator />
                <MenuNote>Subpages keep their place when a page is archived.</MenuNote>
                <MenuItem icon="archive" meta="Reversible" tone="danger">Archive</MenuItem>
              </Menu>
              <div className="system-fieldbutton">
                <Menu label="Status" triggerClassName="field-button" align="start" trigger={<><StatusBadge tone="positive">Version 3</StatusBadge><Glyph name="chevron-down" size="sm" /></>}>
                  <MenuRadio checked onSelect={() => {}} meta="Sep 14">Version 3</MenuRadio>
                  <MenuRadio checked={false} onSelect={() => {}} meta="Sep 12">Version 2</MenuRadio>
                </Menu>
              </div>
            </div>
          </Row>
        </SheetBody>
      </Sheet>

      <Sheet>
        <SheetHeader title="Status, tags, chips, people" />
        <SheetBody>
          <Row label="Status">
            <div className="row">
              <StatusBadge tone="positive">Reviewed</StatusBadge>
              <StatusBadge tone="attention">Unreviewed</StatusBadge>
              <StatusBadge tone="negative">Parsing failed</StatusBadge>
              <StatusBadge tone="progress">Processing</StatusBadge>
              <StatusBadge tone="neutral">Archived</StatusBadge>
            </div>
          </Row>
          <Row label="Tags, chips">
            <div className="row">
              <Tag>Interview</Tag>
              <Tag>admin</Tag>
              <Chip to="/_system" icon="lightbulb">I-1</Chip>
              <Chip icon="scale">3 assumptions</Chip>
              <a className="system-inline-link" href="#main">A link inside a sentence</a>
            </div>
          </Row>
          <Row label="People">
            <div className="row">
              <span className="system-face"><Avatar name="Sam Okafor" /> Sam Okafor</span>
              <span className="system-face"><AgentFace /> Claude Code for Sam</span>
            </div>
          </Row>
          <Row label="Command">
            <CopyField label="Command to connect an agent" value="claude mcp add --transport http whatbuild https://whatbuild.example/mcp" />
          </Row>
        </SheetBody>
      </Sheet>

      <Sheet>
        <SheetHeader title="Evidence" level={2} count={4} filter={<Segmented label="Kind" value="all" onChange={() => {}} items={[{ id: "all", label: "All" }, { id: "interviews", label: "Interviews" }]} />} end={<Button variant="primary" icon="plus">Add source</Button>} />
        <ListRow to="/_system" lead="S-01" title="Crew lead interview, Greenline Landscaping" sub="Interview · Landscaping · added Sep 8 by Claude Code for Sam" end={<StatusBadge tone="positive">Ready</StatusBadge>} />
        <ListRow to="/_system" lead="S-02" title="Owner call notes, Fernside Cleaning, a title long enough to wrap onto a second line on narrow screens" sub="Call notes · Cleaning" end={<StatusBadge tone="progress">Processing</StatusBadge>} />
        <ListRow lead="S-03" title="Planning survey, spring round" sub="Survey export · static row" end="14 passages" />
      </Sheet>

      <div className="system-chrome">
        <Crumbs items={[{ label: "Story", to: "/_system" }, { label: "Where discovery stands", to: "/_system" }, { label: "The problem: planning breaks at the hand-off, not at the grid", to: "/_system" }, { label: "What crew leads told us about Friday afternoons" }]} />
      </div>

      <div className="stack">
        <Callout title="Only the primary file is searched.">The transcript is parsed into passages and searched. The audio recording is kept with the source but never searched.</Callout>
        <Callout tone="attention" title="This product is archived">It is read-only. An admin can restore it in Settings.</Callout>
        <Callout tone="positive" title="Uploaded">Parsing starts in a moment.</Callout>
        <ErrorCallout error={new ApiError(0, "network", "WhatBuild could not be reached. Check your connection and try again.")} onRetry={() => {}} />
        <ErrorCallout error={new ApiError(409, "stale_etag", "That changed since you loaded it.")} onRetry={() => {}} />
        <ErrorCallout error={new ApiError(409, "quota_exceeded", "This team has used its 5 GB of file storage.")} />
        <EmptyState title="No sources yet" action={<Button variant="primary" icon="plus">Add a source</Button>}>
          Sources are the evidence: interviews, call notes, survey exports. Add one, or ask your agent to add them.
        </EmptyState>
      </div>

      <Sheet>
        <SheetHeader title="Loading, empty, in a sheet" />
        <Loading lines={2} />
        <EmptyState size="inline" title="No passages match “weekly”." action={<Button size="sm">Clear the search</Button>} />
        <SheetBody>
          <Callout inset tone="info">An inset callout sits inside a sheet or the inspector.</Callout>
        </SheetBody>
      </Sheet>

      <Sheet>
        <SheetHeader title="Toasts and dialog" />
        <SheetBody>
          <div className="row">
            <Button onClick={() => toast("Note added.")}>Show a toast</Button>
            <Button onClick={() => toast("Archived. It is out of lists and search.", { action: { label: "Undo", onClick: () => toast("Restored.") } })}>With Undo</Button>
            <Button onClick={() => toast("The upload failed. Try again.", { tone: "negative" })}>An error</Button>
            <Button onClick={() => setDialog(true)}>Open a dialog</Button>
          </div>
        </SheetBody>
      </Sheet>
      <Dialog
        open={dialog}
        onClose={() => setDialog(false)}
        title="Move “Jobs or days?”"
        description="Choose the page it should sit under. Its subpages move with it."
        footer={
          <>
            <Button onClick={() => setDialog(false)}>Cancel</Button>
            <Button variant="primary" onClick={() => setDialog(false)}>Move</Button>
          </>
        }
      >
        <FindField label="Find a page" />
        <ChoiceRow type="radio" variant="boxed" name="move" label="Top level" defaultChecked />
        <ChoiceRow type="radio" variant="boxed" name="move" label="Open questions" />
      </Dialog>
    </div>
  );
}
