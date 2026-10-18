/**
 * The sample discovery. Entirely synthetic: the people, organizations and product are invented.
 * It exists so a new install shows the whole loop — sources and their texts, outcomes, an
 * assumption, a mockup and the Story — before anyone uploads anything.
 */

export const SAMPLE = {
  tenant: "Harbor Labs",
  team: "Product team",
  product: "Crewboard",
  concept:
    "Crewboard helps small field-service crews — landscaping, cleaning, repair — plan their week without a spreadsheet. " +
    "We think crew leads lose Friday afternoons rebuilding next week's schedule by hand, and that a planner built around jobs, " +
    "not calendars, could give that time back.",
  outcomes: [
    {
      title: "Plan next week in minutes, not an afternoon",
      description: "A crew lead builds next week's schedule, repeat clients included, without rebuilding it by hand. Success is Friday planning that takes under half an hour.",
    },
    {
      title: "Send every crew the right week, with no mix-ups",
      description: "Each crew knows its jobs, times and addresses before Monday, and a mistake is caught before the client calls. Success is a week with no job missed or double-booked.",
    },
    {
      title: "Fit a new job into the week without starting over",
      description: "When a client books late, the crew lead places the job and sees what it moves. Success is a late booking handled in minutes, from a phone.",
    },
  ],
};

export const INTERVIEW_VTT = `WEBVTT

00:00:02.000 --> 00:00:07.500
<v Interviewer>Thanks for making time. Can you walk me through how next week gets planned?

00:00:08.000 --> 00:00:19.000
<v Marisol>Sure. Friday after lunch I sit down with the spreadsheet. Every job for next week is a row, and I copy the repeat clients forward from this week.

00:00:19.500 --> 00:00:27.000
<v Interviewer>How long does that take?

00:00:27.500 --> 00:00:41.000
<v Marisol>Two hours if nothing's weird. Three if a truck is in the shop or somebody's out. Last month it was most of the afternoon because we had two new commercial accounts.

00:00:41.500 --> 00:00:49.000
<v Interviewer>What makes it weird?

00:00:49.500 --> 00:01:05.000
<v Marisol>People, mostly. I know who can run a crew and who can't, and that's not in the spreadsheet. I keep it in my head. If I'm sick on a Friday, nobody else can do the schedule.

00:01:05.500 --> 00:01:15.000
<v Interviewer>Do you think about the week as days, or as jobs?

00:01:15.500 --> 00:01:30.000
<v Marisol>Jobs. I start with the jobs we have to do, then I figure out which crew and which day. The calendar is the last thing. I only open it to send the texts.

00:01:30.500 --> 00:01:44.000
<v Marisol>The texts are the worst part honestly. Every crew lead gets a message with their jobs and addresses, and I type those by hand. That's where mistakes happen — wrong address, wrong gate code 🔑.

00:01:44.500 --> 00:01:52.000
<v Interviewer>How often does a mistake reach the crew?

00:01:52.500 --> 00:02:04.000
<v Marisol>Maybe once a week. Somebody drives to the wrong side of town. It costs us an hour and sometimes the client notices.
`;

/** The meeting recorder's own export of the Greenline call: a second attachment, read and kept, never searched. */
export const INTERVIEW_RECORDER_EXPORT = `Meeting recorder export
Call: Crew lead interview, Greenline Landscaping
Recorded: 14 August 2026, 2 minutes 4 seconds
Speakers: Interviewer, Marisol (crew lead)
Captions: machine generated, checked by the interviewer

The transcript attached to this source (interview.vtt) was produced from this recording.
`;

/** What an agent wrote about the Greenline call: the source's summary and working notes. */
export const INTERVIEW_AGENT_NOTES = {
  summary:
    "A two-minute call with Marisol, who leads crews at Greenline Landscaping. She plans next week every Friday afternoon from a spreadsheet, " +
    "starting from the jobs rather than the calendar. The costly step is the hand-off: she types each crew lead's jobs and addresses into a text by hand, " +
    "and a wrong address reaches a crew about once a week. Who can lead a crew lives only in her head, so planning stops when she is away.",
  notes: `## Worth following up

- Ask for one of the typed hand-off messages, redacted, to see its exact shape.
- She mentions gate codes: check whether crews need them on every job or only new clients.

## Caution

A single call. Treat the once-a-week mistake rate as her estimate, not a measurement.
`,
};

/** What an agent wrote about each of the other sources: the summary people read when they browse Evidence. */
export const SOURCE_SUMMARIES = {
  oakAndAsh:
    "Dev plans day by day from a spreadsheet. Two weeks ago a client listed twice double-booked the mower crew, and the CONFIRMED column he added since is half empty. " +
    "Time saved on planning would go to answering new customers sooner: slow answers lose him jobs.",
  fernside:
    "Priya plans six cleaning crews alone on Sunday evenings, from memory, a wall calendar and one group chat, where changes after Sunday get lost. " +
    "She asks to see who is free on a given morning, and for one message per crew. She thinks in days and people, not jobs.",
  survey:
    "23 of 41 crew leads answered. 19 plan once a week, for a median of 2.5 hours, most of them in a spreadsheet (14); three of the four on scheduling software still keep one " +
    "\"for the real plan\". In their words, they think in jobs, not time slots, and sending everyone their day takes longest.",
};

export const INTERVIEW_TXT = `Interviewer: Tell me about the last time the schedule went wrong.
Dev: Two weeks ago. We double-booked the mower crew on Tuesday because the spreadsheet had the same client twice.
Interviewer: How did you find out?
Dev: The client called at eight asking where we were. By then the crew was across town.
Interviewer: What did you change after that?
Dev: Nothing really. I added a column that says CONFIRMED but half the time nobody fills it in.
Interviewer: If planning took ten minutes instead of two hours, what would you do with the time?
Dev: Quotes. We lose jobs because I'm slow to quote. People want a price the same day.
Interviewer: Do you plan by the job or by the day?
Dev: By the day, if I'm honest. I look at Monday, fill it, then Tuesday. Jobs that don't fit slide to next week.
`;

export const OWNER_NOTES_MD = `# Notes: owner call with Priya, Fernside Cleaning

## Context

Priya runs six cleaning crews. She plans alone, on Sunday evenings, from a paper wall calendar and a group chat.

## What we heard

She rebuilds the week from memory. Recurring clients are "just known". New clients go on sticky notes until they have a slot.

The group chat is the schedule. Crews scroll up to find their jobs, and changes after Sunday get lost in the scroll.

## Things she asked for

- A way to see who is free on a given morning.
- One message per crew, not a thread everyone reads.

## Our read

She thinks in days and people, not jobs. Different from the landscaping leads.
`;

export const RESEARCH_EXPORT_MD = `# Planning survey, spring round — summary export

## Method

Short survey sent to 41 crew leads through two trade associations. 23 responded.

## Results

Planning happens once a week for 19 of 23 respondents; the rest plan day to day.

The median time spent on weekly planning was 2.5 hours.

Spreadsheets were the main tool for 14 respondents, paper for 5, and scheduling software for 4. Three of the four software users said they still keep a spreadsheet "for the real plan".

## Open comments

"The software wants me to think in time slots. I think in jobs."

"Sending everybody their day is what takes forever."
`;

export const STORY_HTML = (links: { assumption: string; handOff: string }, css: string) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Where Crewboard's discovery stands</title>
<style>
${css}</style>
</head>
<body>
<main class="page">
<header class="opening">
<p class="kicker">Crewboard · Where discovery stands</p>
<h1>The costly part of planning is sending the plan, not making it</h1>
<p class="lead">Crew leads spend a Friday afternoon building next week. The mistakes that reach customers happen afterwards, when the plan is typed out to each crew.</p>
<p class="meta">Sample discovery · Working interpretation</p>
</header>
<section aria-labelledby="heard">
<h2 id="heard">What we heard</h2>
<aside class="note">Four sources: two interviews, owner-call notes and a survey export of 23 responses. Every person and company here is invented.</aside>
<p>Planning is a weekly ritual of two to three hours, in a spreadsheet or on paper. The errors crews feel, a wrong address or a double booking, enter when the plan is copied into messages by hand.</p>
<figure class="quote"><blockquote><p>The texts are the worst part honestly. Every crew lead gets a message with their jobs and addresses, and I type those by hand.</p></blockquote><figcaption>Crew lead, landscaping · interview</figcaption></figure>
</section>
<section aria-labelledby="next">
<h2 id="next">What we are doing next</h2>
<p><span class="status" data-state="evidence">Planned</span> <a href="${links.handOff}">Test the hand-off first</a>, before the planning grid.</p>
<ol class="steps"><li>Prototype a message generated from the plan, and test it with two crews.</li><li>Interview two more cleaning-crew owners about how they think about the week.</li></ol>
<aside class="callout" data-tone="caution"><p><strong>Assumption, unconfirmed.</strong> Whether leads think in jobs or in days is <a href="${links.assumption}" target="_blank" rel="noopener noreferrer">an open assumption</a>.</p></aside>
</section>
</main>
</body>
</html>`;

/** Notes for agents on the overview page: what the page is for and what is still to do. */
export const OVERVIEW_NOTES = `## Purpose

The one-screen summary of where Crewboard's discovery stands, for Riley and the two advisors. Keep it to a single screen.

## Still to fold in

- Priya's call notes (Fernside Cleaning): only mentioned in the limits aside so far.
- The survey's open comments on time slots versus jobs.

## Structure decisions

- Lead with the hand-off, not the planning grid: the plan to test generated crew messages is the headline.
- Keep "jobs or days" labelled as an open assumption until someone reviews it.
`;

export const HANDOFF_NOTES = `## Purpose

Explains the hand-off test for the two crews taking part. A sub-page of the overview.

## Next revision

- Add the two crews' results when the test ends, in their own words where they say it best.
- Do not state a success threshold until Riley sets one.
`;

export const HANDOFF_HTML = (css: string) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>The hand-off test</title>
<style>
${css}</style>
</head>
<body>
<main class="page">
<header class="opening">
<p class="kicker">Crewboard · Planned test</p>
<h1>The hand-off test</h1>
<p class="lead">Two crews will get their week as a message generated from the plan, instead of one typed by hand.</p>
<p class="meta">Sample discovery · Planned test</p>
</header>
<section aria-labelledby="why">
<h2 id="why">Why this first</h2>
<p>Typed messages are where wrong addresses and gate codes enter, and a wrong address reaches a crew about once a week. A generated message is small to build and useful whichever planning model wins.</p>
<figure class="quote"><blockquote><p>Maybe once a week. Somebody drives to the wrong side of town.</p></blockquote><figcaption>Crew lead, landscaping · interview</figcaption></figure>
</section>
<section aria-labelledby="look">
<h2 id="look">What we will look at</h2>
<ol class="steps"><li>Whether the crews notice anything missing from the generated message.</li><li>How long the planner spends sending the week, before and after.</li></ol>
<aside class="callout"><p><strong>Planned, not yet run.</strong> The two crews start next week.</p></aside>
</section>
</main>
</body>
</html>`;

/** The sample mockup: three pages that test the jobs-or-days assumption. Synthetic, like everything here. */
const MOCK_CSS = `*{box-sizing:border-box}body{margin:0;font:15px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;color:#1c2321;background:#f6f5f1}
header{display:flex;align-items:center;gap:12px;padding:14px 24px;background:#1f3b34;color:#fff}header b{font-size:17px}header span{opacity:.75;font-size:13px}
main{padding:20px 24px}h2{font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:#5b6662;margin:0 0 10px}
.cols{display:grid;gap:14px}.card{background:#fff;border:1px solid #e1ded6;border-radius:10px;padding:12px 14px}
.card b{display:block}.meta{color:#5b6662;font-size:13px}.tag{display:inline-block;font-size:12px;padding:1px 8px;border-radius:99px;background:#e6efe9;color:#1f3b34;margin-top:6px}
.warn{background:#fbecd9;color:#7a4a10}.btn{display:inline-block;padding:8px 14px;border-radius:8px;background:#1f3b34;color:#fff;font-weight:600}`;

const mock = (title: string, body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><style>${MOCK_CSS}</style></head><body>${body}</body></html>`;

export const MOCKUP = {
  title: "Planning the week: jobs first or days first",
  summary: "Two ways to plan next week, and the message each crew gets from it.",
  brief: `# Planning the week: jobs first or days first

## What this canvas explores

Crew leads disagree about how they think about the week. Marisol plans **jobs first** and fits them into days; Dev and Priya plan **day by day**. This canvas puts both models side by side, plus the crew message either one would send, so the team can show them to crew leads and watch which one they reach for.

## Questions it should answer

1. Does a crew lead with a repeat-client week reach for the jobs board or the day planner first?
2. Can either view show a late booking's knock-on effect without a second screen?
3. Is the generated crew message enough on its own, whichever planner wins?

## The pages

- **Jobs board**: unscheduled jobs on the left, crews as columns; drag a job onto a crew and day.
- **Day planner**: one column per day, crews as rows; repeat clients pre-filled from last week.
- **Crew message**: what Marisol's crew sees on a phone on Sunday night.

## What it draws on

The assumption that crew leads think in jobs, not time slots; the Greenline call; the planning survey.`,
  pages: {
    jobs: mock(
      "Jobs board",
      `<header><b>Crewboard</b><span>Week of 12 Oct · Jobs board</span></header><main><div class="cols" style="grid-template-columns:260px 1fr 1fr 1fr">
<section><h2>Unscheduled · 4</h2><div class="cols"><div class="card"><b>Hedge trim, 14 Alder Rd</b><span class="meta">Repeat · 2 h</span><br><span class="tag">Every 2 weeks</span></div><div class="card"><b>Spring clean-up, Oak Ct</b><span class="meta">New client · 4 h</span></div><div class="card"><b>Mulch beds, Library</b><span class="meta">Repeat · 3 h</span></div><div class="card"><b>Gutter check, 9 Bay St</b><span class="meta">Late booking · 1 h</span><br><span class="tag warn">Booked Thursday</span></div></div></section>
<section><h2>Crew A · Marisol</h2><div class="cols"><div class="card"><b>Mon · Riverside HOA</b><span class="meta">6 h</span></div><div class="card"><b>Tue · Pine St duplex</b><span class="meta">3 h</span></div></div></section>
<section><h2>Crew B · Dev</h2><div class="cols"><div class="card"><b>Mon · Clinic lawn</b><span class="meta">2 h</span></div><div class="card"><b>Wed · Harbor school</b><span class="meta">5 h</span></div></div></section>
<section><h2>Crew C · Priya</h2><div class="cols"><div class="card"><b>Tue · Office park</b><span class="meta">4 h</span></div></div></section>
</div></main>`,
    ),
    days: mock(
      "Day planner",
      `<header><b>Crewboard</b><span>Week of 12 Oct · Day planner</span></header><main><div class="cols" style="grid-template-columns:repeat(5,1fr)">
${["Mon", "Tue", "Wed", "Thu", "Fri"]
  .map(
    (d, i) =>
      `<section><h2>${d}</h2><div class="cols"><div class="card"><b>Crew A</b><span class="meta">${["Riverside HOA", "Pine St duplex", "Hedge trim, Alder Rd", "Mulch beds", "—"][i]}</span></div><div class="card"><b>Crew B</b><span class="meta">${["Clinic lawn", "—", "Harbor school", "Spring clean-up", "Clinic lawn"][i]}</span></div><div class="card"><b>Crew C</b><span class="meta">${["—", "Office park", "—", "Gutter check", "Office park"][i]}</span>${i === 3 ? '<br><span class="tag warn">Moved from Wed</span>' : ""}</div></div></section>`,
  )
  .join("")}
</div><p class="meta" style="margin-top:16px">Repeat clients are filled in from last week. <span class="btn">Send the week</span></p></main>`,
    ),
    message: mock(
      "Crew message",
      `<header><b>Crewboard</b><span>Crew A · next week</span></header><main><h2>Hi Marisol, here is next week</h2><div class="cols">
<div class="card"><b>Monday · Riverside HOA</b><span class="meta">8:00 · 220 Riverside Dr · 6 h</span></div>
<div class="card"><b>Tuesday · Pine St duplex</b><span class="meta">8:30 · 41 Pine St · 3 h</span></div>
<div class="card"><b>Wednesday · Hedge trim</b><span class="meta">9:00 · 14 Alder Rd · 2 h · gate code 4471</span></div>
<div class="card"><b>Thursday · Mulch beds</b><span class="meta">8:00 · Library, 3 Main St · 3 h</span></div>
</div><p style="margin-top:16px"><span class="btn">Looks right</span> <span class="meta">or reply with a change</span></p></main>`,
    ),
  },
  notes: {
    jobs: "Jobs first, for leads like Marisol. Watch whether the unscheduled column feels like a to-do list or like pressure.",
    jobsRevised: "Jobs first, for leads like Marisol. In the first walk-through the late booking was found at once here; the knock-on effect on Crew B was not.",
    days: "Days first, for leads like Dev and Priya. Repeat clients pre-filled from last week is the bet: planning becomes correcting.",
    message: "Phone width. The message is the same whichever planner wins, which is why it is worth testing first (see the hand-off test on the Story).",
  },
  /** Files the canvas carries for whoever builds the next version: never used to draw a page. */
  files: {
    design: `# Crewboard mockups: design notes

How these pages are built, so the next version looks like it belongs.

- **Type.** The system font at 15px for everything a crew lead reads; 12px uppercase labels for
  column heads and the week. Nothing larger than 20px.
- **Colour.** Ink #1c2321 on paper #f6f5f1, white cards, and one green, #1f3d34, for the header
  and the one action on a page. A late booking is the only thing in amber.
- **Cards.** One card per job: the job in bold, then time, place and hours on one muted line.
  Gate codes and access notes ride on that line; crews ask for them first.
- **Phone.** The crew message is 390 wide and must read without zooming. One action, "Looks right",
  and a plain way to reply with a change.
`,
    card: `<!-- A job card, as every page draws it. Copy it; pages never include it. -->
<div class="card">
  <b>Monday · Riverside HOA</b>
  <span class="meta">8:00 · 220 Riverside Dr · 6 h</span>
</div>
`,
  },
};
