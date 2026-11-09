---
version: 1
slug: "src-routes"
primary_target: "src/routes"
related_targets: []
---

# Surface brief: California Budget Explorer (all routes)

Scope: every route under src/routes (shell, Overview/Key Map, Spending/By type/Revenue explorers, department pages, Flows, Reconciliation, Sources, Search). Visitor mode: **Read**: the reader's question leads; the world owns the frame, the reading column stays calm.

Audience and job: curious Californians, half on phones from a shared link, half on laptops drilling in; they arrive with a lay question and leave with an answer they can trust and repeat. Proof is the real 2026-27 data and its official page references; nothing invented.

Constraints: non-partisan (no red/blue coding), independent-not-official (no seals, state-portal blue, Caltrans green), not academic. Light and dark, phone and desktop first-class. Keyboard/table fallbacks from the critique fixes stay. Code-led (no image generation).

Memorable moment: turning to a page: every figure has a page-and-grid reference you can follow.

Open decisions: none. The 3D city becomes an opt-in "aerial view" off the Key Map.

## Direction contract

THESIS: The budget as the Thomas Guide every Californian kept in the car: an atlas where every figure has a page and a grid square, and going deeper means turning to the page. It refuses the civic dashboard of KPI tiles, bordered cards and accent blue.

OWN-WORLD: Cool map-white ground, never cream; ink-black type. Agencies are shaded in pastel city tints with dark casing lines, like neighbouring cities on an atlas page. Road classes carry hierarchy: freeway yellow for the current selection and primary marks, arterial orange for actions, white streets for minor rules. There's water blue and park green, a hairline legend box, condensed caps for labels, an A–J / 1–7 margin grid, black page tabs, and dot-leader index lines. Barlow Semi Condensed is used for map labels and the frame, Barlow for reading, with tabular figures. Night mode is the atlas under a dome light: ink-navy ground with the tints glowing.

STORY: The visitor opens the Key Map and sees the total and the agencies as tinted blocks, each with its page number. They turn to a page, read a figure with its "Sched. 9 · p. 14" reference, and follow "continued on page" arrows down to a line item, trusting every step because every step names its page.

FIRST VIEWPORT: A running head: atlas title at left, edition "2026-27 Enacted" and the Street Index search at right. A black page tab reads KEY MAP. The headline total is set large with its source reference beneath. The Key Map is the agencies as tinted, cased blocks with page-number roundels inside a lettered and numbered margin grid. To the right, a legend box and "How to read this atlas". The primary action is to click a block or "Turn to page".

FORM: Thomas Guide street atlas, #1 on the ordered list (taken as the pick over the rolled California Modern); seed:7e8dbbce1bbf0e6c. Signature interaction: "turn to page", a horizontal page-turn transition on drill, page-and-grid references on every figure, and Search as a Street Index.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
