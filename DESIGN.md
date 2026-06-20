# Design

## Overview

Carry's dashboard is a light-themed customer-facing product demo for a clinical command center. The visual system should feel calm, precise, premium, and enterprise-ready. It should avoid neon colors, emoji, developer-console density, and generic AI dashboard tropes.

The UI should explain the product through an organized narrative:

1. Today: what is coming up and what Carry already knows.
2. Live Visit: what Carry hears, filters, understands, and drafts.
3. Patient Graph: what Carry safely carries forward across visits.

## Color System

Use OKLCH colors. Keep the palette restrained.

### Scene

A clinician or buyer is reviewing a web dashboard on a laptop in a bright office or conference room during a product demo. The interface should be light, legible, quiet, and trustworthy.

### Tokens

- `--paper`: warm clinical paper background, not pure white.
- `--surface`: slightly raised neutral panels.
- `--surface-strong`: selected or grouped neutral surfaces.
- `--ink`: tinted near-black for primary text, never pure black.
- `--muted`: secondary text.
- `--line`: soft structural borders.
- `--accent`: restrained blue for primary action and selected navigation.
- `--success`: muted green for completed tool actions.
- `--warning`: warm amber for clinician-review-required states.
- `--danger`: muted red for allergy conflicts, cancelled medications, or safety-critical states.

### Usage

- Accent blue is for primary actions, selected navigation, and active workflow states only.
- Amber marks review-required content.
- Red marks clinical conflict or cancelled/avoid states.
- Green marks completed external actions.
- Do not use neon, high-saturation gradients, or decorative color washes.

## Typography

Use a single system UI stack:

```css
font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
```

Product typography should be compact and trustworthy.

- Page title: 32px, 700 to 760 weight, tight tracking.
- Section title: 20 to 24px, 700 weight.
- Panel title: 15 to 17px, 700 weight.
- Body: 14 to 15px, 400 to 500 weight.
- Labels: 11 to 12px, 700 to 760 weight, uppercase only for metadata.

Avoid oversized marketing hero type inside the app. This is a product dashboard, not a landing page.

## Layout

Use a stable app shell:

- Left sidebar or compact top-left brand area.
- Three primary pages: Today, Live Visit, Patient Graph.
- Main content width should feel spacious but not sprawling.
- Use panels sparingly. Avoid nested cards.
- Prioritize a clear reading path from left to right and top to bottom.

The customer should never be presented with all raw data at once. Use progressive disclosure:

- Default view: concise summary and status.
- Expanded view: details, evidence, JSON-like clinical output.
- Final review: SOAP draft, decision trail, actions.

## Components

### Navigation

Simple, persistent, and calm. Active state uses a subtle filled neutral or accent treatment. No decorative icons or emoji.

### Status Pills

Small, rounded labels for:

- Listening
- Processing
- Review required
- Synced to Notion
- Calendar proposed
- Completed

Each pill must include text, not just color.

### Transcript Rows

Each transcript row should show:

- Speaker label.
- Incoming text.
- Sanitized text only when it differs or when privacy proof is useful.
- Redaction labels as quiet chips.

Avoid making the transcript feel like a terminal log.

### Clinical Insight Panels

Use concise sections:

- Current summary.
- Medication decision trail.
- Missing information.
- Safety checks.

The medication decision trail should be especially clear:

1. Initially proposed.
2. Allergy or contraindication discovered.
3. Cancelled or avoided.
4. Current plan.

### Patient Graph

Use a timeline and structured lists rather than a literal node graph for MVP. Sections:

- Visits.
- Allergies.
- Medications.
- Follow-ups.
- Open questions.
- Tool sync history.

## Motion

Use short, functional transitions only, 150 to 220ms. Motion should communicate state changes such as new transcript rows, pass completed, final draft ready, or tool sync completed. No page-load choreography or decorative animation.

## Copy Guidelines

- No emoji.
- No em dashes.
- Avoid hype words such as magical, autonomous, or HIPAA-compliant.
- Say clinician review required for clinical outputs.
- Use privacy-first or compliance-oriented architecture.
- Keep labels short and concrete.

## Demo-Specific UX

The main demo path should be:

1. Today page shows the returning patient and pre-read.
2. Start live visit from the pre-read card.
3. Live Visit streams the conversation with privacy filtering.
4. Carry highlights medication change and allergy conflict.
5. Final draft appears with clinician-review status.
6. Notion sync appears as completed.
7. Patient Graph updates with the visit, allergy, medication, and follow-up context.

The interface should look ready for a customer conversation, not like an internal prototype.
