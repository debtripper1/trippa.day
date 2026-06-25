# trippa.day — AI Workflow Guide

This document defines how I (the AI) access, modify, and deploy the website.

## Access

I operate on a local clone of the repository at:

```
C:\OPENCODE\TRIPPA.DAY
```

The remote is:

```
https://github.com/debtripper1/trippa.day.git
```

The site is hosted on **Cloudflare Pages**, which auto-deploys from the `main` branch on GitHub. The `dev` branch also deploys to a preview URL automatically.

## Branch Strategy

- **`dev`** — default working branch. All changes land here first.
- **`main`** — production. Mirrors what's live at `https://trippa.day`.

## Workflow

```
dev (work here) → commit → push origin/dev
                        → (optional) merge to main → push origin/main → Cloudflare deploys
```

## Rule: I NEVER push to `main` without your explicit sign-off

This is the critical rule:

1. **All changes go to `dev`** by default. I commit and push to `origin/dev` after every task.
2. **Merging to `main` requires your explicit approval.** I will ask you directly with a message like:
   > *"Ready to push to prod. Say 'yes, push to main' when you're good."*
3. **Your exact sign-off phrase is:** `"yes, push to main"` or `"push to prod"` or any clear equivalent. Until you say one of these, the changes stay on `dev`.

I will never assume approval. If you're AFK or don't respond, the code stays on `dev`.

## Per-Task Commitment Log

By default, each session:
1. I confirm the task and branch (`dev`)
2. I implement the changes
3. I commit and push to `origin/dev`
4. I ask for your sign-off before merging to `main`
5. Only after you approve do I merge and push `main`

## Exceptions

None. Even a one-line doc fix goes through `dev` first unless you explicitly say to skip it to `main`.

---

*Last updated: 2026-06-25*
