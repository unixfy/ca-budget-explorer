# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary user is the curious member of the public: a Californian who wants a basic sense of where the state's money comes from and where it goes, without reading budget documents or knowing budget jargon. They come with general questions ("how much goes to schools?", "what does the General Fund pay for?") and leave with an answer they can trust and repeat.

The explorer goes down to every published line item, but that depth exists so a curious person can keep pulling the thread. It is not an analyst workbench, and it doesn't assume budget knowledge at any level.

## Product Purpose

The California state budget is very large and very complex. This product makes it understandable. It covers both expenditures and revenues, and every figure comes from official publications (ebudget.ca.gov and the Department of Finance). Success means a non-expert can go from a headline total to a specific program or revenue source, understand what they're looking at, and see where the number came from.

## Positioning

Three things together set it apart from ebudget.ca.gov, LAO publications and generic open-budget sites:

1. **Every line item.** You can drill from the statewide total down to every published line item, not just top-level summaries.
2. **Provenance.** Every number traces back to an official source document. The reconciliation and source-map views show how the explorer's totals match DOF's published figures, and where each one came from.
3. **Exploratory visualization.** Treemap, sunburst, Sankey flows and a 3D "budget city" make a very large budget feel approachable to a lay audience, not intimidating.

## Operating Context

- People mostly arrive cold, with a question, often from a link or a search. The default route is the latest enacted budget (`/2026-27/e`).
- Datasets are keyed by fiscal year and point in time (`p` Governor's Budget, `m` May Revision, `e` Enacted), and the header switches between them. Only 2026-27 Enacted is published so far (plus a fixture dataset for development).
- Global settings are year (budget, current, or prior year), compare year, fund filter, and theme. They persist per browser.
- Fund filter semantics follow DOF. "All funds" ($793.7B in 2026-27) includes reimbursements and nongovernmental cost funds, which double-count. "State funds" (General + special + bond) is DOF's headline figure.

## Capabilities and Constraints

- Static SPA (SvelteKit + adapter-static), with no backend. Data is precomputed JSON in `static/data/{fy}/{pit}/`, indexed by `static/data/manifest.json`. The canonical schema is `src/lib/data/schema.ts`.
- The ETL (`scripts/etl/`) pulls only from official sources. Raw downloads are cached in `data-raw/`. Amounts are stored in thousands of dollars.
- Views: Overview, Spending (agency → department → program tree), By type (what the money pays for), Revenue, Flows (Sankey), Reconciliation, Source map, Sources. There are also department detail pages, search, and a command palette.
- Light, dark and system themes. `prefers-reduced-motion` is respected.
- No deploy target or formal accessibility standard has been decided yet.

## Brand Commitments

- **Name:** California Budget Explorer.
- **Non-partisan voice.** Copy is neutral and factual. It never editorializes about spending choices, calls things good or bad, or frames one side's narrative. It explains what the money is and where it goes.
- **Independent, not official.** The product must never look like an official State of California or DOF site. It uses official data but doesn't borrow state seals, branding or government-portal styling, and it doesn't imply endorsement.

## Evidence on Hand

- Official budget data for 2026-27 Enacted: `static/data/2026-27/e/` (expenditures, revenues, flows, funds, by type, reconciliation, sources catalog, search, meta).
- A per-dataset source catalog listing the official documents each figure comes from: `sources-catalog.json`, produced by `scripts/etl/sources-catalog.ts`.
- There are no testimonials, usage numbers, press or partner endorsements. Future work must not invent any.

## Product Principles

1. **Answer the lay question first.** Every view opens on something a non-expert can read in seconds. Depth is available on demand and never required.
2. **Every number shows its source.** A figure that can't be traced to an official document doesn't ship. Provenance is a feature, not a footnote.
3. **Neutral by construction.** Wording, ordering and emphasis describe the budget. They don't argue about it.
4. **Make the scale tangible.** Use visualization to make an incomprehensibly large sum feel concrete and explorable, and use it to inform, not to decorate.
5. **Plain language over budget jargon.** When DOF terms are unavoidable (fund types, points in time, character of expenditure), explain them where they appear.
