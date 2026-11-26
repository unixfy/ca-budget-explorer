---
name: California Budget Explorer
description: The California state budget as a street atlas, where every number has a page.
colors:
  arterial-orange: "#a8441b"
  freeway-yellow: "#f2c230"
  water-blue: "#2f6f9f"
  park-green: "#3c7a45"
  map-white: "#f3f6f4"
  map-white-shade: "#e6ece8"
  hairline: "#c9d3cd"
  ink: "#15191c"
  error-red: "#b3261e"
  night-ground: "#0f151c"
  night-shade: "#161e27"
  night-hairline: "#2a3541"
  night-ink: "#e8edef"
  night-arterial: "#f59a5c"
  night-freeway: "#f2c94c"
  night-water: "#7fbce0"
  tint-sun: "#f6e07a"
  tint-park: "#b8dca6"
  tint-water: "#a6d0ee"
  tint-peach: "#f4b8a0"
  tint-lilac: "#e3bfdf"
  tint-tan: "#f6cd93"
  tint-periwinkle: "#c8c2ec"
  tint-rose: "#f1a8b4"
  tint-unincorporated: "#d5dcd8"
typography:
  display:
    fontFamily: "Barlow, ui-sans-serif, system-ui, sans-serif"
    fontSize: "3rem"
    fontWeight: 700
    lineHeight: 1.05
    letterSpacing: "-0.025em"
  figure:
    fontFamily: "Barlow, ui-sans-serif, system-ui, sans-serif"
    fontSize: "3rem"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.025em"
    fontFeature: "tnum"
  headline:
    fontFamily: "Barlow, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.25
  body:
    fontFamily: "Barlow, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "Barlow Semi Condensed, Barlow, ui-sans-serif, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.06em"
rounded:
  crisp: "2px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "40px"
components:
  page-tab-number:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.map-white}"
    typography: "{typography.label}"
    padding: "6px 10px"
  page-tab-name:
    backgroundColor: "{colors.map-white}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    padding: "6px 10px"
  button-primary:
    backgroundColor: "{colors.arterial-orange}"
    textColor: "#ffffff"
    typography: "{typography.label}"
    rounded: "{rounded.crisp}"
    padding: "0 16px"
    height: "44px"
  button-outline:
    backgroundColor: "{colors.map-white}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.crisp}"
    padding: "0 16px"
    height: "44px"
  nav-tab:
    backgroundColor: "{colors.map-white}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    padding: "0 12px"
    height: "44px"
  nav-tab-active:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.map-white}"
    typography: "{typography.label}"
    padding: "0 12px"
    height: "44px"
  atlas-inset:
    backgroundColor: "{colors.map-white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.crisp}"
    padding: "12px"
  map-block:
    backgroundColor: "{colors.tint-sun}"
    textColor: "{colors.ink}"
    rounded: "{rounded.crisp}"
---

# Design System: California Budget Explorer

## Overview

**Creative North Star: "Every Number Has a Page"**

The explorer is drawn as the street atlas Californians used to keep in the car, the kind with a key map on the inside cover, numbered pages, a lettered and numbered grid in every margin, and an index at the back. The budget is the territory. Agencies, departments and revenue sources are the shaded blocks, and the reader finds anything the same way they found a street: turn to the page and look in the square. The metaphor does real work rather than decorating the page. Every budget item has a computed page and grid reference ("p. 312 · C4"), and every figure names the official page it came from.

The world lives in the frame and stays out of the reading column. The page tabs, running head, margin grid, legend boxes, index lines and map blocks carry the atlas. Prose sits in a calm sans at a readable measure on a cool map-white ground. Density is that of a reference book: plenty of information, organised by hairlines and space instead of boxes. Light mode is the atlas by day. Night mode is the same atlas read under a car's dome light.

The look is deliberately neither an official state portal (no seals, no government blue, no Caltrans green), nor partisan (no red/blue coding, no valence colour on increases and cuts), nor academic.

**Key Characteristics:**
- Pastel city tints with dark casing outlines for every mapped entity.
- Condensed caps (Barlow Semi Condensed) for every label, tab and reference; Barlow for reading.
- Black page tabs and numbered roundels; an A–J / 1–7 margin grid around maps.
- Dot-leader index lines that run a name across to its page and square.
- Flat, crisp, 2px corners; hairlines instead of cards.

## Colors

A cool, nearly neutral map ground carries pastel tints for territory, with road colours for action and selection.

### Primary
- **Arterial Orange** (`arterial-orange`): links, primary actions and anything the reader can follow. It's the arterial road of the map. In night mode it brightens to `night-arterial`.

### Secondary
- **Freeway Yellow** (`freeway-yellow`): selection and "you are here". It marks the hovered or focused map block, the selected row, the active filter and text selection. It always sits under ink text and never carries text colour itself.

### Tertiary
- **Water Blue** (`water-blue`) and **Park Green** (`park-green`): revenue and reserves/balances in charts, the water and parks of the map. Their night counterparts are `night-water` and the lighter green.

### Neutral
- **Map White** (`map-white`): the page ground. It's cool, never cream.
- **Map White Shade** (`map-white-shade`): table header bands and hover fills.
- **Hairline** (`hairline`): row rules and minor dividers.
- **Ink** (`ink`): text, casing outlines, page tabs, legend borders and major rules.
- **Night Ground / Shade / Hairline / Ink** (`night-*`): the same roles under the dome light.

### City Tints
- **Sun, Park, Water, Peach, Lilac, Tan, Periwinkle, Rose** (`tint-*`, light; deeper equivalents in `src/lib/viz/palette.ts` for night): one per top-level entity, assigned by budget size and kept fixed across years and filters. Entities beyond eight fold into **Unincorporated** (`tint-unincorporated`) and rely on direct labels. Light tints carry ink labels (≥9:1); night tints carry light labels (≥4.5:1).

### Named Rules
**The No Valence Rule.** Increases and decreases are both drawn in neutral ink with a small triangle and a sign. Green-for-up and red-for-down editorialise spending, so they never appear.

**The Yellow Means Here Rule.** Freeway yellow marks only the reader's current place or selection. It is never decoration and never a warning by itself. A "not published" state may share the hue but must also carry text.

**The Error Is Rare Rule.** Error red is used only for real failures (data didn't load). Gaps in official data are neutral or yellow with words, never red.

## Typography

**Display Font:** Barlow (with system sans fallback)
**Body Font:** Barlow
**Label Font:** Barlow Semi Condensed

**Character:** Barlow was drawn from California's road signs and license plates, so it is the atlas's own lettering. The semi-condensed cut in caps does the work of an atlas's printed street names; the regular cut reads calmly at length.

### Hierarchy
- **Display** (700, 1.875rem → 3rem at md, 1.05, −0.025em): the page title (h1) under every page tab.
- **Figure** (600, 2.25rem → 3rem, tabular figures): the headline amount on each page.
- **Headline** (600–700, 1.25–1.5rem): section headings, in normal case.
- **Body** (400, 1rem, 1.6): prose, held to about 65–75 characters.
- **Label** (600, 0.75–0.875rem, 0.06em, uppercase): page tabs, nav, legend titles, table headers, map labels, page and grid references, buttons.

### Named Rules
**The Street Name Rule.** Condensed caps are for naming and referencing things: labels, tabs, references, table headers, buttons. They are never used for sentences or headings people read as prose.

**The Tabular Money Rule.** Every amount uses tabular figures so columns of dollars align.

## Layout

- **Page frame:** pages sit in a container up to 1536px wide with 16px side gutters.
- **Running head:** a sticky header with a single ink rule beneath it. It holds the product name, the page-tab nav (which wraps to a second scrolling row below 1280px), "Street index" and "View".
- **Page opening:** every page opens the same way: page tab, then the h1, a one-line lead, the headline figure and its source citation.
- **Map pages:** the map takes the main column, wrapped in the A–J / 1–7 margin grid from 640px up, and a 19–21rem side column holds a single legend or inset plus ruled notes. Below 1024px the side column stacks under the map. Maps take their height from their width, with a 260px minimum.
- **Spacing rhythm:** 4 / 8 / 16 / 24 / 40px. Sections are separated by 24–40px and an ink or hairline rule, with more space above a heading than below it.
- **Touch targets:** at least 44px on touch-sized layouts.

## Elevation & Depth

The atlas is printed paper, so it's flat. Depth comes from casing outlines, tints and rules rather than shadows. The only shadows are a soft drop under floating layers that genuinely sit above the page: the View panel (`0 8px 24px -12px rgb(0 0 0 / .35)`) and the Street Index dialog (`0 16px 40px -16px rgb(0 0 0 / .45)`).

**The Printed Page Rule.** Nothing on the page itself has a shadow. A shadow means the layer is floating over the page and can be dismissed.

## Shapes

- **Corners:** crisp everywhere (2px). Map blocks are cased with a 1–1.5px ink outline, thicker at the top level.
- **Page-number roundels:** black circles with light numerals, the one round form in the system.
- **Containers:** the only box is the hairline "atlas inset" (1px ink border), used for legends, "how to read" panels, key figures and dialogs. Everything else is divided by rules.

## Components

### Page Tab
The black page-number block next to an outlined name block, both in condensed caps. Every page has one:
- Budget pages show their computed number (e.g. 101).
- Overview and tree roots read KEY MAP.
- Front matter uses lettered pages: Flows "ii", Reconciliation "iii", Sources "iv", Street Index "Index".

### Page Reference
"p. 312 · C4" or "Key Map · C4", in condensed caps with tabular figures. It is announced to screen readers as "page 312, square C4". It sits beside items in tables, the index and the running head.

### Source Citation
"SOURCE · Enacted Budget Summary Schedule 9, p. 14" on one compact line, with a small drawn external-link icon and a "How we built this" link. It sits directly under any figure a reader might repeat.

### Buttons
- **Shape:** crisp (2px), flat, at least 44px tall.
- **Primary:** arterial orange with light text, in condensed caps.
- **Outline:** a 1px ink border on the map ground.
- **Ghost / tab:** no border; hover fills with map-white shade.
- **Focus:** a 2px ink outline offset by 2px.

### Navigation and Tabs
Condensed-caps tabs on the map ground. The active tab is the black page tab (ink fill, light text). This applies to the main nav, chart-type tabs, department tabs, year tabs and source tabs. All of them keep the WAI-ARIA tabs pattern.

### Map Block (treemap, Key Map)
A tinted block, cased in ink, with its name in condensed caps, its amount in tabular figures, and a page roundel when the item has its own page. Hover and focus add a freeway-yellow outline over the casing. The chart is a single Tab stop and arrow keys move between blocks.

### Index Line
Name, a dotted leader, the amount, then the page reference. Used in the Street Index, the "largest" lists, the "not counted" and positions rows, and source lists.

### Legend and Inset
A hairline box titled in condensed caps, holding swatches drawn as small cased rectangles or road lines, with optional notes beneath a rule.

### Index Table
Data tables get a map-white-shade header band in condensed caps, hairline rows and tabular figures. Sortable headers keep `aria-sort`.

## Do's and Don'ts

### Do:
- **Do** open every page with a Page Tab and then the h1.
- **Do** give every budget figure a page reference and every published figure a source citation.
- **Do** shade entities with the city tints and case them in ink; keep each entity's tint fixed across years and filters.
- **Do** use freeway yellow only for "here / selected", and arterial orange for things to follow.
- **Do** separate sections with space and rules, and keep prose to a 65–75 character measure.

### Don't:
- **Don't** use red/green (or red/blue) to code increases, cuts, or parties.
- **Don't** use state seals, government blue, Caltrans green, or anything that reads as an official State site.
- **Don't** build pages from stacks of cards, rows of KPI tiles, or eyebrow labels above headings.
- **Don't** put shadows, gradients, or glass on the page itself.
- **Don't** use condensed caps for sentences or reading text.
- **Don't** use emoji or unicode glyphs as icons; draw small SVG icons in one stroke weight.
