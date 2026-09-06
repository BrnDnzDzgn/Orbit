# Orbit

A personal-growth workspace: one calm place for the tools you use to become who
you're trying to be. A Pomodoro timer, recurring dailies, longer-horizon goals,
a calendar, a habits mirror, an activity view, and a notebook — eight tools
under one shell, rather than eight apps.

Live at **https://brndnzdzgn.github.io/Orbit/**

## Running it

```sh
npm install
npm run dev        # vite dev server
npm run verify     # lint → CSS collisions → build → real-browser layout check
npm run deploy     # build and publish to the gh-pages branch
```

`verify` is the one to run before pushing. It catches the class of bug that a
build alone cannot: `check:css` fails when two stylesheets define the same
class or animate a keyframe they don't own, and `check:layout` drives headless
Chrome over the built site and asserts every tool's canvas actually fills the
width it's given. Both exist because a green build once shipped an app that was
unusable on screen.

## Where the decisions live

- **[PRODUCT.md](PRODUCT.md)** — what Orbit is, what's shipped, the hard
  constraints, and why each non-obvious decision went the way it did.
- **[DESIGN.md](DESIGN.md)** — the visual authority: palette, type, spacing,
  motion, and the per-tool specifications in §11.

Read those before changing anything. Most of what looks arbitrary in the code
is explained in one of them.

## The one constraint that shapes everything

Orbit is a static site with **no backend, no accounts, and no sync**. Everything
anyone accumulates lives in one browser's `localStorage`, namespaced `orbit:`,
and nowhere else. Nothing in the product may imply durability it cannot deliver
— which is why Notes carries a mandatory export, and why Settings can take a
full backup of every key, restore one, or erase the lot.

Routing is hash-based for the same reason: GitHub Pages serves a 404 for any
path it has no file for, so a history-API route would break on refresh.

## Stack

React 19, Vite 8, and `lucide-react` for icons. No router, no state library, no
CSS framework, no component library — deliberately, at this size. The one place
that discipline was genuinely tested is the Notes editor, which is built from
controlled textareas rather than taking a rich-text dependency; PRODUCT.md
explains why owning that format matters more than editor fidelity here.
