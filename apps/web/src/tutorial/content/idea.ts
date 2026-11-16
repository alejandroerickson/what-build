import { CalendarCheck, House, MessageSquare, Repeat, Send, Sheet, Truck, UserCheck, UserRound, Users } from "lucide-react";
import type { IdeaContent } from "./types.ts";

/** Idea: Crewboard's product concept, with its picture and its More info text, and one outcome. */
export const IDEA: IdeaContent = {
  concept: {
    title: "Product concept",
    text: [
      "Crewboard helps small field-service crews (landscaping, cleaning, repair) plan their week without a spreadsheet.",
      "",
      "**Who it is for.** The crew lead of a business running two to four crews, often its owner. They plan next week on Friday afternoon, mostly from repeat clients, and send each crew its jobs before Monday.",
      "",
      "**The problem.** Crew leads lose Friday afternoons rebuilding next week’s schedule by hand: copying repeat clients forward, matching each job to a crew from memory, and typing every crew’s jobs and addresses into texts.",
      "",
      "**How Crewboard solves it.** A planner built around jobs, not calendars. Repeat jobs carry forward, each job is matched to a crew that can do it, and each crew’s week is sent from the plan.",
      "",
      "**What it is not.** Not a calendar, not dispatch or route optimisation, and not invoicing.",
    ].join("\n"),
    front: {
      pitch: { before: "Crewboard gives crew leads their ", marked: "Friday afternoon", after: " back." },
      lede: "A week planner for small field-service crews (landscaping, cleaning, repair) that starts from the jobs, not the calendar.",
      today: {
        heading: "Today, every Friday",
        steps: [
          { icon: Sheet, name: "Spreadsheet", line: "repeat clients copied forward" },
          { icon: UserRound, name: "Memory", line: "who can lead which job", tone: "pain" },
          { icon: MessageSquare, name: "Texts", line: "typed one by one", tone: "pain" },
        ],
      },
      after: {
        heading: "With Crewboard",
        steps: [
          { icon: Repeat, name: "Jobs", line: "carried forward" },
          { icon: Users, name: "Crews", line: "matched to each job" },
          { icon: Send, name: "The week", line: "sent to every crew", tone: "new" },
        ],
      },
      who: [
        { icon: UserCheck, name: "Crew leads", line: "plan next week for two to four crews" },
        { icon: Truck, name: "Crews", line: "need their jobs and addresses by Monday" },
        { icon: House, name: "Clients", line: "book repeat visits, and late jobs" },
      ],
    },
  },
  outcomes: [
    {
      id: "tutorial-outcome-1",
      title: "Plan next week in minutes, not an afternoon",
      text: [
        "A crew lead builds next week’s schedule, repeat clients included, without rebuilding it by hand.",
        "",
        "**What success looks like.** Friday planning takes under half an hour. Repeat jobs are already in next week when the crew lead opens it; what is left is placing the new and changed jobs and checking each crew’s load.",
      ].join("\n"),
      front: {
        caption: "Time to plan next week",
        today: { label: "Today", value: "an afternoon" },
        success: { label: "Success", value: "under 30 min", share: 0.125 },
        steps: [
          { icon: Repeat, name: "Repeat jobs", line: "already in place" },
          { icon: Users, name: "Crews", line: "matched per job" },
          { icon: CalendarCheck, name: "The week", line: "ready to send", tone: "new" },
        ],
      },
    },
  ],
};
