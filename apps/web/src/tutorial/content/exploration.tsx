import type { ReactNode } from "react";
import type { ExplorationContent } from "./types.ts";

/*
 * Exploration: one canvas of three pages that link to each other. A page carries Crewboard's own
 * look, never the app's, as an agent's page does (`.tut-page` in tutorial.css). A link to another page
 * names it with `data-page-link`, and the canvas follows it as it follows a link inside a frame.
 */

function Card({ title, line, tag }: { title: string; line: string; tag?: string }) {
  return (
    <div className="cb-card">
      <b>{title}</b>
      <span>{line}</span>
      {tag ? <i>{tag}</i> : null}
    </div>
  );
}

function Top({ where }: { where: string }) {
  return (
    <header className="cb-top">
      <b>Crewboard</b>
      <span>{where}</span>
    </header>
  );
}

function Go({ to, children }: { to: string; children: ReactNode }) {
  return (
    <a className="cb-btn" data-page-link={to} href={`${to}.html`}>
      {children}
    </a>
  );
}

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

type Slot = [string, string, string?];
function Week({ title, rows }: { title: string; rows: Slot[][] }) {
  return (
    <>
      <h3>{title}</h3>
      <div className="cb-week">
        <div className="cb-week-head">
          {DAYS.map((d) => (
            <span key={d}>{d}</span>
          ))}
        </div>
        {rows.map((row, r) => (
          <div key={r} className="cb-week-row">
            {row.map(([t, s, tag], c) => (
              <Card key={c} title={t} line={s} tag={tag} />
            ))}
          </div>
        ))}
      </div>
    </>
  );
}

const A = (s: string, tag?: string): Slot => ["Crew A", s, tag];
const B = (s: string, tag?: string): Slot => ["Crew B", s, tag];
const C = (s: string, tag?: string): Slot => ["Crew C", s, tag];

function JobsBoard() {
  return (
    <div className="cb">
      <Top where="Week of 12 Oct · Jobs board" />
      <div className="cb-cols">
        <section>
          <h4>Unscheduled · 4</h4>
          <Card title="Hedge trim, 14 Alder Rd" line="Repeat · 2 h" tag="Every 2 weeks" />
          <Card title="Spring clean-up, Oak Ct" line="New client · 4 h" />
          <Card title="Mulch beds, Library" line="Repeat · 3 h" />
          <Card title="Gutter check, 9 Bay St" line="Late booking · 1 h" tag="Booked Thursday" />
        </section>
        <section>
          <h4>Crew A · Marisol</h4>
          <Card title="Mon · Riverside HOA" line="4 h" />
          <Card title="Tue · Pine St duplex" line="3 h" />
        </section>
        <section>
          <h4>Crew B · Dev</h4>
          <Card title="Mon · Clinic lawn" line="2 h" />
          <Card title="Wed · Harbor school" line="5 h" />
        </section>
        <section>
          <h4>Crew C · Priya</h4>
          <Card title="Tue · Office park" line="4 h" />
        </section>
      </div>
      <Go to="day-planner">Plan by day</Go>
    </div>
  );
}

function DayPlanner() {
  return (
    <div className="cb">
      <Top where="Week of 12 Oct · Day planner" />
      <div className="cb-day">
        <div className="cb-day-bar">
          <p>Repeat clients are filled in from last week.</p>
          <Go to="crew-message">Send the week</Go>
        </div>
        <Week
          title="Week of 12 Oct"
          rows={[
            [A("Riverside HOA"), A("Pine St duplex"), A("Hedge trim, Alder Rd"), A("Mulch beds"), A("—")],
            [B("Clinic lawn"), B("—"), B("Harbor school"), B("Spring clean-up"), B("Clinic lawn")],
            [C("Office park"), C("Office park"), C("—"), C("Gutter check", "Moved from Wed"), C("Office park")],
          ]}
        />
        <Week
          title="Week of 19 Oct"
          rows={[
            [A("Riverside HOA"), A("Pine St duplex"), A("—"), A("Library beds"), A("Riverside HOA")],
            [B("Clinic lawn"), B("Harbor school"), B("—"), B("Oak Ct"), B("Clinic lawn")],
            [C("Office park"), C("—"), C("Bay St"), C("Office park"), C("—")],
          ]}
        />
        <Week
          title="Week of 26 Oct"
          rows={[
            [A("Riverside HOA"), A("—"), A("Alder Rd"), A("Mulch beds"), A("—")],
            [B("Clinic lawn"), B("Clinic lawn"), B("Harbor school"), B("—"), B("Oak Ct")],
            [C("Office park"), C("Office park"), C("—"), C("—"), C("Bay St")],
          ]}
        />
      </div>
    </div>
  );
}

function CrewMessage() {
  return (
    <div className="cb cb-phone">
      <Top where="Crew A · next week" />
      <div className="cb-msg">
        <p className="cb-hi">Hi Marisol, here is next week</p>
        <Card title="Monday · Riverside HOA" line="8:00 · 220 Riverside Dr · 4 h" />
        <Card title="Tuesday · Pine St duplex" line="8:30 · 41 Pine St · 3 h" />
        <Card title="Wednesday · Hedge trim" line="8:00 · 14 Alder Rd · 2 h · gate code 4471" />
        <Card title="Thursday · Mulch beds" line="9:00 · Library, 3 Main St · 3 h" />
        <Go to="jobs-board">Looks right</Go>
      </div>
    </div>
  );
}

export const EXPLORATION: ExplorationContent = {
  mockup: {
    id: "tutorial-mockup-1",
    title: "Planning the week: jobs first or days first",
    summary: "Two ways to plan next week, and the message each crew gets from it.",
    brief: [
      "## What this canvas explores",
      "",
      "Crew leads plan the week two ways. Marisol starts from the jobs and fits them into days; Dev and Priya plan day by day. Both are here, with the message either one would send.",
    ].join("\n"),
    version: 2,
    columns: 3,
    publishedAt: "2026-09-02T10:00:00.000Z",
  },
  pages: [
    {
      page_id: "jobs-board",
      title: "Jobs board",
      width: 1280,
      height: 800,
      notes: "Jobs first, for leads like Marisol. In the first walk-through the late booking was found at once here; the knock-on effect on Crew B was not.",
      draw: () => <JobsBoard />,
    },
    {
      page_id: "day-planner",
      title: "Day planner",
      width: 1280,
      height: 1500,
      notes: "Day by day, for leads like Dev and Priya. Three weeks on one page, so a repeat client can be followed down it.",
      draw: () => <DayPlanner />,
    },
    {
      page_id: "crew-message",
      title: "Crew message",
      width: 390,
      height: 800,
      notes: "What a crew lead gets on a phone once the week is sent.",
      draw: () => <CrewMessage />,
    },
  ],
};
