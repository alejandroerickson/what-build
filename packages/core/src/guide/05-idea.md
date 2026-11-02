# The idea: product concept and outcomes

The product concept and outcomes, how their cards work, what the server checks, and their revisions.

## The product concept and outcomes

The **product concept** says who the product is for, the problem they have, and how the product
solves it (`products_read(action="get")`; `products_write(action="update_concept")` changes it).

An **outcome** is what the product's users should be able to achieve with it, written from their
side ("The crew lead plans next week in minutes"). In WhatBuild's model the rest of the product
relates to the outcomes: assumptions point at the outcomes they bear on through `outcome_ids`, and
listing assumptions with an `outcome_id` shows them. Outcomes are listed with
`outcomes_read(action="list")` and written with `outcomes_write(action="create")` and `update`.

- An outcome names no record: a title, description or front holding a record's id (a source, an
  assumption, a mockup, a Story page) is refused with `outcome_cites_a_record`.
- An outcome is current or archived; there is no "achieved". `outcomes_write(action="archive")` and
  `restore` move it between the two. `list` leaves archived ones out unless `include_archived`, and
  they can still be linked.
- An update changes only the fields it passes and keeps the text it replaced as a revision:
  `outcomes_read(action="revisions")` lists them, `get_revision` reads one, and
  `outcomes_write(action="restore_revision")` brings one back as a new change.

## Cards

The concept and each outcome is a **card**. On the Idea screen people see each card's front first;
More info opens its back, between the card's title and the front. People read both, arrange and
archive outcomes, and restore earlier versions, but write neither side in the app: only agents write
cards, with the editor role.

- **The front** (`card_html`) is a picture of the idea: any still picture HTML, CSS and inline SVG
  can make, in the colours of WhatBuild's card kit, which also has parts for common pictures.
  `outcomes_read(action="card_guidance")` gives how to draw one with worked examples, the kit's
  parts, the pictogram names `data-icon` accepts, the widths and most height a front is shown at,
  the longest front (`max_chars`), and the checks it advises.
- **The back** (the product's `concept`, an outcome's `description`; Markdown) is the same idea as
  text. It is what agents read, and what a person opens More info to see.
- **Both sides change together.** A call that changes one side sends the other in the same call;
  sending one alone is refused with `card_sides_together`. A rename alone needs no new front.
  `products_read(action="get", include_card=true)` and `outcomes_read(action="get")` return both
  sides; a list gives only `card_chars`, the front's length (0 when there is none).
- **`card_advice`.** A write that touches a card returns `card_advice` when the card misses something
  the guidance advises (too many words, the title repeated, more than one hue, fixed colours, an
  empty back). It never refuses the write.
- A card with no front shows people its text and a request for a picture, and
  `products_read(action="get")`, `outcomes_read(action="list")` and the write itself say so in `note`.

## Previewing a front

`outcomes_read(action="card_preview")` (with `kind="concept"` for the concept) needs the role a write
needs. It makes every check the write makes (`422 invalid_card`, listing every problem;
`outcome_cites_a_record`) and stores nothing anyone sees. Otherwise it returns `card_advice`, `frame`
(the widths the front is shown at and the most height a desktop shows) and a short-lived grant: GET
its `url` with exactly its `headers` to receive the front as the Idea screen shows it, with a dashed
line where a desktop stops showing it and a note saying how tall the front is. A phone shows the
whole front. `?theme=light` and `?theme=dark` choose the theme. The grant expires (`expires_at`), and
its header is a credential.
