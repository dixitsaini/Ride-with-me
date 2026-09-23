# Rider App Documentation

## Blueprint Set

The project documentation is intentionally separated into focused documents.

### 01 — Product Experience

Answers:

> What does the rider see, do, and expect?

Contains:

- User journeys
- Screen responsibilities
- Product flows
- UX behavior
- Important scenarios

---

### 02 — Architecture Flow

Answers:

> What must exist first, and how do capabilities depend on each other?

Contains:

- Foundation
- Location
- Realtime
- Map
- Ride
- Data ownership
- Architecture boundaries
- Failure/recovery principles

---

### 03 — Modular Product Blueprint

Answers:

> What exactly does each product module own?

Contains:

- Module purpose
- Capabilities
- Screens
- Dependencies
- Outputs
- Expected behavior
- Module handoffs

---

### 04 — Development Roadmap

Answers:

> What do we build first, what can run in parallel, and when is it done?

Contains:

- Development phases
- Team ownership
- Dependencies
- Parallel work
- Definition of Done
- MVP gates

---

## Decision Records

Architecture decisions belong in:

docs/decisions/

Use ADRs for decisions that materially affect:

- architecture
- technology
- data ownership
- storage
- realtime
- security
- privacy
- platform behavior
- monetization

---

## Golden Rule

If implementation behavior differs from the documented product or architecture behavior:

1. Stop.
2. Determine whether the documentation or implementation should change.
3. Record the decision.
4. Continue implementation.

The codebase and documentation must not silently drift apart.
