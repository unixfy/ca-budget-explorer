# ca-budget-explorer

Interactive explorer to understand the very complex CA state budget — expenditures and revenues,
drillable to every published line item, built only from official sources (ebudget.ca.gov / DOF).

## Run

```sh
npm install
npm run dev          # http://localhost:5173 -> /2026-27/e
npm run build        # static SPA in build/
```

## Data

Canonical, year-agnostic contract: `src/lib/data/schema.ts`. Output lives in `static/data/{fy}/{pit}/`
(`pit`: `p` Governor's Budget, `m` May Revision, `e` Enacted), indexed by `static/data/manifest.json`.

```sh
npm run etl:exp   -- --fy 2026-27 --pit e   # ebudget JSON API + department PDFs -> expenditures, departments/*, funds, search, meta
npm run etl:rev   -- --fy 2026-27 --pit e   # DOF Summary Schedules 1/6/8/9/10 + fund condition statements -> revenues, flows
npm run etl:patch -- --fy 2026-27 --pit e   # merge revenue totals + search entries into meta/search
npm run etl:type  -- --fy 2026-27 --pit e   # every program row -> bytype (what the money pays for; rules in scripts/etl/lib/spend-types.ts)
```

Raw downloads are cached in `data-raw/` (gitignored); re-runs are offline. Amounts are in thousands of dollars.

Fund filter note: the default view is DOF's headline "state funds" (General + special + bond;
$351.7B in 2026-27). The "State + federal funds" choice adds federal funds ($538.9B). Neither is
DOF's "all funds" figure ($793.7B), which also counts reimbursements and nongovernmental cost
funds; those double-count, so the explorer reports them separately and never adds them to totals.
