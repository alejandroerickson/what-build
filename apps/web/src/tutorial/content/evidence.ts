import { TUTORIAL_ACTOR, type EvidenceContent } from "./types.ts";
import whiteboard from "./whiteboard.svg?no-inline";

const AT = "2026-08-14T15:00:00.000Z";

/**
 * Evidence: one source, a crew lead interview with a whiteboard photo and a transcript. Its preview
 * opens on the photo. The photo is a static file of the web app, shown as the list's picture of it.
 */
export const EVIDENCE: EvidenceContent = {
  sources: [
    {
      record_id: "tutorial-source-1",
      title: "Crew lead interview — Greenline Landscaping, Aug 2026",
      date: "2026-08-14",
      tags: ["interview", "greenline landscaping", "planning"],
      uploaded_by: TUTORIAL_ACTOR,
      uploaded_at: AT,
      updated_at: AT,
      updated_by: TUTORIAL_ACTOR,
      archived_at: null,
      derived_status: "ready",
      text_chars: 1480,
      attachment_count: 2,
      etag: "tutorial",
      text_from: "transcript.vtt",
      summary:
        "A two-minute call with Marisol, who leads crews at Greenline Landscaping. She plans next week every Friday afternoon from a spreadsheet, starting from the jobs rather than the calendar. The costly step is the hand-off: she types each crew lead’s jobs and addresses into a text by hand, and a wrong address reaches a crew about once a week.",
      card_etag: null,
      first_lines: "Interviewer: Thanks for making time. Can you walk me through how next week gets planned?\nMarisol: Sure. Friday after lunch I sit down with the spreadsheet.",
      attachments: [
        {
          path: "whiteboard.jpg",
          media_type: "image/jpeg",
          size: 2_516_582,
          file_version_id: "tutorial-whiteboard",
          text: { status: "unsupported", chars: 0, duration_ms: null },
          picture: { made_from: "image", thumb_url: whiteboard, preview_url: whiteboard, width: 800, height: 500, pages: null, card: null },
        },
        {
          path: "transcript.vtt",
          media_type: "text/vtt",
          size: 1_912,
          file_version_id: "tutorial-transcript",
          text: { status: "ready", chars: 1480, duration_ms: null },
          picture: null,
        },
      ],
    },
  ],
  preview: { source: "tutorial-source-1", page: 1 },
};
