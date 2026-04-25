# Frontend docs

Short, durable references that don't fit in code comments. The live
counterpart to most of these is a route in the running app — prefer the
live page when reviewing or onboarding.

| Doc | Purpose | Live counterpart |
| --- | --- | --- |
| [design-system.md](./design-system.md) | Three durable rules for new UI code | `/design-system` |

## When to add a new doc here

A new file belongs in `frontend/docs/` only when:

- The information is **durable** (won't rot in a sprint).
- It can't live in a code comment without bloating the file.
- It's not better expressed as a live page that imports the real code
  (a stale doc is worse than no doc; a live page can't go stale).

Anything else — design notes, in-flight RFCs, ad-hoc decisions — belongs
in a PR description, an issue, or `CLAUDE.md` memory. Keep this folder
small.
