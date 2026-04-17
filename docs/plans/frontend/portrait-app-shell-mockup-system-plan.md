# Portrait App-Shell Mockup System For RUNARA

## Summary

This work adds a separate mockup-only route tree for evaluating layout decisions without changing the current production UI. The mockups will behave like a portrait mobile app rather than a responsive document site.

Core rules:

- landing is the only page allowed to scroll normally
- every non-landing screen uses a fixed-height portrait app shell
- non-landing screens include a thin transparent top bar with `RUNARA` on the top-left
- primary navigation lives in a bottom footnav with `Characters`, `Run`, and `Sync`
- page-level scrolling is disallowed on non-landing screens
- overflow is allowed only inside explicit interior panes such as logs, lists, histories, or dense forms

Current UI assessment:

- preserve the strongest primitives: badges, panel/card surfaces, field/button patterns, key-value sections, and the clearer stacked structure used by the run result screen
- redesign the current orchestration model in `components/game/GameClient.tsx`
- replace landscape-biased interaction patterns such as the horizontal zone carousel and multi-column mobile defaults

## Implementation Changes

### Dedicated mockup route tree

Create a separate mockup namespace under `app/mockups/...` and keep the live routes unchanged.

Initial mockup routes:

- `app/mockups/page.tsx`
- `app/mockups/characters/page.tsx`
- `app/mockups/characters/create/page.tsx`
- `app/mockups/characters/[characterId]/page.tsx`
- `app/mockups/run/page.tsx`
- `app/mockups/sync/page.tsx`
- `app/mockups/runs/[runId]/page.tsx`
- `app/mockups/share/runs/[runId]/page.tsx`

### Reusable mockup primitives

Create a small mockup-only component layer under `components/mockups/...`.

Required primitives:

- `MockAppShell`
- `MockTopBar`
- `MockFootNav`
- `MockSectionCard`
- `MockScrollablePane`
- `MockStatusBadge`
- `MockKeyValueList`
- `MockActionRow`

These components must favor:

- one-column composition first
- fixed shell height
- no horizontal scroll for primary content
- internal bounded scroll regions for dense secondary content

### Screen mockups

Build skeletal layout mockups for:

1. landing
2. characters roster
3. character creation
4. character overview
5. run
6. sync
7. run result
8. shared run result

Per-screen intent:

- landing remains document-like and can scroll
- characters, run, sync, and result screens use the fixed shell
- character overview becomes the main in-app summary pattern
- run replaces the current horizontal selector with a vertical portrait-first layout
- sync keeps long history inside a bounded scroll pane
- run result keeps summary visible and moves the encounter log into a scrollable region

### Keep and drop decisions

Keep:

- badge semantics
- card/panel treatment
- field and action patterns
- key-value summaries
- stacked section composition

Drop or redesign:

- horizontal zone carousel
- page composition embedded in one monolithic client component
- default two-column mobile layouts for core information
- overflow-heavy rows for primary content
- web-page-like navigation between core in-app states

## Test Plan

Structural verification:

- each mockup route renders without touching the live UI flow
- every non-landing mockup screen renders inside a fixed portrait shell
- top bar and footnav stay consistent across all non-landing mockups
- non-landing screens do not require full-page vertical scrolling
- only bounded interior panes scroll
- reusable mockup primitives are shared across screens

## Assumptions

- the mockups are used to lock layout, not visual polish
- static sample data is acceptable for the first pass
- `Characters`, `Run`, and `Sync` are the only persistent footnav destinations
- character detail and run result remain contextual screens inside the same shell model
