/**
 * The sample discovery. Entirely synthetic: the people, organizations and product are invented.
 * It exists so a new install shows the whole loop — sources, passages, objectives, an insight,
 * register entries and a Story page — before anyone uploads anything.
 */

export const SAMPLE = {
  tenant: "Harbor Labs",
  team: "Product team",
  product: "Crewboard",
  idea:
    "Crewboard helps small field-service crews — landscaping, cleaning, repair — plan their week without a spreadsheet. " +
    "We think crew leads lose Friday afternoons rebuilding next week's schedule by hand, and that a planner built around jobs, " +
    "not calendars, could give that time back.",
  objectives: [
    {
      title: "Know how crews plan their week today",
      description: "Map the planning ritual end to end: who does it, when, with what tools, and where it breaks. Success is a map we can point at with evidence behind each step.",
    },
    {
      title: "Find the moment planning costs the most",
      description: "Identify the single most expensive step, in time or in mistakes, that a planner could remove. Success is one step we can name and measure.",
    },
    {
      title: "Decide whether jobs-first beats calendar-first",
      description: "Learn whether crew leads think in jobs or in time slots, so the first version is built around the right object.",
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

export const INSIGHT = {
  title: "Planning is a weekly ritual that breaks at the hand-off, not the plan",
  summary:
    "Crew leads spend two to three hours a week building next week, but the costly mistakes happen when the plan is sent to crews by hand.",
  body: (ids: { vtt: string; txt: string; survey: string; notes: string }) => `## What we observed

Weekly planning is a fixed ritual. Marisol plans on Friday afternoons in a spreadsheet and it takes two to three hours (source ${ids.vtt}, segments 1–3). The survey puts the median at 2.5 hours across 23 leads (source ${ids.survey}).

The plan itself is not where most mistakes enter. Marisol describes the **hand-off** as the failure point: she types each crew's jobs and addresses into text messages and says that is where mistakes happen (source ${ids.vtt}, segment 8), and a wrong address reaches a crew about once a week (segments 9–10).

Knowledge about people lives in the planner's head. Marisol is the only one who can build the schedule, because who can run a crew "is not in the spreadsheet" (source ${ids.vtt}, segment 5).

## How we read it

The expensive step is not deciding the plan but **distributing** it. A planner that only speeds up building the week would miss where the time and the errors are.

We are less sure about the planning object. Marisol and the survey comments think in jobs; Dev and Priya think in days (source ${ids.txt}; source ${ids.notes}). That split is recorded as an open assumption, not settled.

## What follows

- Test a version that generates each crew's message from the plan, before investing in the planning grid itself.
- Interview two more cleaning-crew owners to see whether the jobs-versus-days split follows the trade.
`,
};

export const STORY_HTML = (links: { insight: string; assumption: string; decision: string }, css: string) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Where Crewboard's discovery stands</title>
<style>
${css}</style>
</head>
<body>
<main class="wb-page wb-split">
<article class="wb-prose">
<header class="wb-stack">
<h1>The costly part of planning is sending the plan, not making it</h1>
<p class="wb-lead">Crew leads spend a Friday afternoon building next week. The mistakes that reach customers happen afterwards, when the plan is typed out to each crew.</p>
<p class="wb-meta">Sample discovery · Working interpretation</p>
</header>
<h2>What we heard</h2>
<p>Planning is a weekly ritual of two to three hours, in a spreadsheet or on paper. The errors crews feel — a wrong address, a double booking — enter when the plan is copied into messages by hand.</p>
<figure class="wb-quote"><blockquote><p>The texts are the worst part honestly. Every crew lead gets a message with their jobs and addresses, and I type those by hand.</p></blockquote><figcaption>Crew lead, landscaping · interview · <a href="${links.insight}" target="_blank" rel="noopener noreferrer">Read the insight</a></figcaption></figure>
<h2>What we are doing next</h2>
<ol><li>Prototype a message generated from the plan, and test it with two crews.</li><li>Interview two more cleaning-crew owners about how they think about the week.</li></ol>
</article>
<aside class="wb-stack" aria-labelledby="limits">
<h2 id="limits">Evidence and limits</h2>
<p><span class="wb-status" data-state="open">Unconfirmed</span> Whether leads think in jobs or in days is <a href="${links.assumption}" target="_blank" rel="noopener noreferrer">an open assumption</a>.</p>
<p><span class="wb-status" data-state="evidence">Decided</span> <a href="${links.decision}" target="_blank" rel="noopener noreferrer">Test the hand-off first</a>, before the planning grid.</p>
<p class="wb-meta">Four sources: two interviews, owner-call notes, a survey export of 23 responses. All synthetic.</p>
</aside>
</main>
</body>
</html>`;
