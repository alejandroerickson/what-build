---
title: One search finds anything in a product by plain words, from anywhere, the same on the web and over MCP
organizations: [standard, sandbox]
people: [sam, jordan]
surfaces: [web, mcp]
---

# Search

A person searches everything in a product from one place, the palette (the panel's Search field,
⌘K or `/`) or the Search screen, by plain words as they type; an agent gets the same reading as
`search`'s `plain` mode. This plan checks that every kind of thing can be found, that the words are
read as the specification says (any order, forgiving endings, the last word as a prefix, typos
corrected and said so, partial matches that name the missing words), that the web and MCP agree,
that what one door writes the other finds at once, and that a reader has no search
(`okf/spec/08-search.md` §8.2, `okf/spec/07-web-app.md` §7.2).

## Steps

1. **MCP, as Sam, in the standard organization.** In a product that has sources, mockups,
   assumptions and Story pages, list each kind and note, for later steps: a word you can see in a
   source's text (`derived(action="text")`) that it says in several places, far apart (more than
   three if there is one), a word from an assumption's statement, a word from a mockup's page text,
   an outcome's title, a Story page's title, and a word from the product concept. If the product
   has no mockup, create one over MCP with two pages of synthetic text, one holding a made-up word.
   *Expect:* each of them exists; say in the report which product you used, by its path.
2. **Web, as Sam.** Open the product's Idea. *Expect:* under the product switch, the panel's Search
   field reads "Search <product>" with its shortcut in a key cap. Click it. *Expect:* the palette
   opens as the field alone, with focus in it; with nothing typed, there are no recent searches yet.
   Leave it untouched for three seconds: it flashes once and settles.
3. **Web, as Sam.** In the palette, type the text word from step 1, a letter at a time.
   *Expect:* results arrive as you type, without Enter, at most eight, best match first, each with
   its kind's glyph, the title with the words marked, what it is (a source with its date and its
   number of matches) and a line of matching text saying where it is ("In its text"); the field's
   button reads "All N results". Move down with the arrow keys and press Enter on a source whose
   line says "In its text" (its title may hold the word too). *Expect:* the source opens on its
   Text with the word marked from the match the line showed, the find field holding it and
   counting the matches, and the palette is closed.
4. **Web, as Sam.** On the source, press `/`. *Expect:* the palette opens again with the words
   from step 3, selected, so typing replaces them. Delete them. *Expect:* the search is under
   "Recent searches". Pick it. *Expect:* it fills the field. Press Escape, then go through the
   panel (not by address, which reloads the app) to Evidence, a mockup's canvas and the Story,
   opening the palette with ⌘K (Ctrl+K off a Mac) on each. *Expect:* each time it opens with the
   words you left in it. Click into any text field
   on a screen, such as a comment or a title, and type `/`. *Expect:* the slash is typed and no
   palette opens. Clear the recent searches with Clear. *Expect:* the list is gone, and stays gone
   after reloading.
5. **Web, as Sam.** In the palette, search each word noted in step 1 in turn. *Expect:* the
   assumption, the mockup, the outcome, the Story page and the product concept are each found,
   labelled as what they are (an assumption with its status, a mockup with the page the words are
   on), and opening each goes to that object (the mockup at that page, the outcome on Idea scrolled
   to and marked, the concept on Idea).
6. **Web, as Sam.** Try how words are read, in the palette and on the Search screen:
   - the text word with a different ending (plural or "-ing") and two words in reverse order;
     *Expect:* the same things found;
   - the text word cut short by two or three letters; *Expect:* found, as the last word is a
     prefix;
   - the text word with one letter swapped or wrong; *Expect:* the results for the real word,
     with "Showing results for <word>." On the Search screen, "Search for <typo> instead" searches
     the typo as typed and finds nothing;
   - the text word with "the" and "of" around it; *Expect:* the Search screen says "Left out: the,
     of" and finds what the word alone finds;
   - the text word and a made-up word; *Expect:* "Nothing has all your words." in both; on the
     Search screen only, each result also names the made-up word as Missing
     (`okf/spec/07-web-app.md` §7.2);
   - a made-up word alone; *Expect:* no error; the palette says "Nothing in <product> matches
     “<word>”. Try another word.", and the Search screen "Nothing matches “<word>”" over "Try
     another word, or fewer words."; searched again in straight quotes, `"<word>"`, it shows in
     one pair of quotation marks in both, never two;
   - "mockups" and a word from a mockup; *Expect:* "Mockups first.", and the mockup leads;
   - two words side by side in one source's text, in quotes, then the same two in the other order
     in quotes; *Expect:* the first finds that source, the second does not;
   - a word you can see in a source's summary, then one from one of its comments; *Expect:* the
     source is found, the hit saying "In its summary" or "In a comment", and opening it shows the
     source's Text under its summary, or its Comments.
7. **Web, as Sam.** Type the text word and press "All N results" (⌘Enter). *Expect:* the Search
   screen opens with the words at `/search?q=…`, and the palette, opened again, is empty. The
   results sit under Idea, Evidence, Exploration and Story, in that order, each a sheet with its
   count; the panel lists Everything and each area holding a result, with counts that add up to
   Everything's. Choose Evidence in the panel. *Expect:* only Evidence's sheet, `?show=evidence` in
   the address, and Everything brings the rest back. Then search a word most sources hold, so that
   more than 60 things match. *Expect:* the palette's button counts every match (the sum of the
   response's `counts` over MCP), and the Search screen says "Showing the best 60 of
   N. Add a word to narrow them."
8. **Web, as Sam.** On the Search screen, find the source with the most matches. *Expect:* it is
   listed once, with the best three places it says the words, each saying where, and "N more
   places in this source". Follow that. *Expect:* every place in that source, as many as its
   number of matches said, and a way back to searching everything. Open one of them, not the
   first. *Expect:* the source's Text with the words marked, the find field starting at that
   place's own match (not "1 of …"), and stepping from one match to the next with its Previous
   and Next buttons, or Enter and Shift+Enter (the arrow keys do not step).
9. **Web, as Sam.** Open `/search?q=<the text word>&mode=ranked&scope=all`, an address in the
   old form. *Expect:* the new Search screen with the same words. Open Evidence. *Expect:* its panel
   holds only the filters: Tags and Archived, and Added by only when more than one person has
   added sources (a fresh golden master shows Tags and Archived alone); no search of its own and no
   Added window; the headings read as headings. Open `…/evidence?query=<a word in a source title>`.
   *Expect:* the sources whose titles, tags or attachment names hold the word, shown as a filter
   in use, "“<word>” in titles, tags or attachment names", that can be removed.
10. **MCP, as Sam.** Call `search` with `mode: "plain"` for the queries of steps 3 and 6.
    *Expect:* the same results as the web showed, in the same order, with `corrections`,
    `partial`, `missing`, `ignored` and `kind_hint` saying what the web's notes said; a source's
    `hits` name their `field` and where their piece starts. Then call `search` in the default
    mode with the text word, and read the text around its first hit in `text` with
    `derived(action="text")`, from a little before its `char_start`. *Expect:* each hit names its
    `field`, `char_start` and `char_end`; the window holds the word; `coverage` lists what was
    searched and ends "Attachments are never searched." Then plain mode with `kind: "mockup"`,
    with `record_id` of the source from step 8, and with `strict: true` and the typo. *Expect:* one
    kind only; that source's hits only; no correction and nothing found. Then `mode: "plain"` with
    `tags`, `kind` with `mode: "substring"`, and `scope: "passages"`. *Expect:* each refused with
    `invalid_filter` or `invalid_input` and a message that says why.
11. **MCP, then web, as Sam.** Over MCP, create an assumption whose statement holds a made-up word
    (synthetic, such as "zorbleflux"), with a body saying why, as the skill describes. On the web, search
    the made-up word straight away. *Expect:* the assumption is found, under Exploration on the
    Search screen. Archive it on the web, then search the word over MCP. *Expect:* nothing is found.
12. **Web and MCP, as Sam, in the sandbox organization.** In the same product, repeat the palette
    search of step 3 and the queries of step 6, and the MCP search of step 10. *Expect:* the same
    results as in the standard organization, which holds the same content, and the made-up word of
    step 11 is found in neither organization's sandbox copy.
13. **Web and MCP, as Jordan (reader).** Open the product. *Expect:* the panel has no Search field;
    ⌘K and `/` do nothing; `/search?q=<a word>` takes Jordan to the Story with a toast, without an
    error. Over MCP, `search` in plain mode is refused with a clear error, not an empty result.
14. **Web, as Sam.** At phone width (390 × 844) and in the dark theme, open the palette, search, and
    open the Search screen. *Expect:* the palette fits the screen and its results are readable;
    marked words stand out in both themes; nothing overflows or overlaps.

## Look out for

- Results that lag the words typed, flash the previous answer, or stay on the spinner; a search
  that takes more than about a second on a large product.
- A source matched in several places listed more than once, or a hit that opens the wrong
  section, or the text without the words marked.
- Marks that cover the wrong letters, especially after a corrected or shortened word, or in text
  with accents.
- The web and MCP disagreeing on what a query found, or the two organizations disagreeing.
- `!` problems while typing fast, or on opening and closing the palette repeatedly.
