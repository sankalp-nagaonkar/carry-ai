# Carry Mobile (Flutter) — Build Prompt

Use this as a single, self-contained prompt to build the **Carry** mobile app in Flutter.
Carry is the companion app for a wearable clinical co-pilot. It listens during a visit,
privacy-filters every word on device, drafts clinician-review notes, and carries patient
context forward across visits.

Keep it calm, precise, and premium. This is a clinical product, not a consumer toy.

---

## 0. One-line brief

Build a Flutter app (iOS + Android) that mirrors the Carry clinical co-pilot: a doctor opens
the app before a visit, sees a pre-read built from prior visits, taps to start listening,
watches the live transcript get privacy-filtered and understood in real time, reviews and
signs off on a drafted SOAP note, and the patient knowledge graph grows after every visit.

---

## 1. Product model (what the app actually does)

Flow, end to end:

1. **Capture** — wearable (or phone mic for demo) streams transcript chunks while the doctor and patient talk.
2. **Privacy filter** — direct identifiers (name, phone, email, DOB) are masked on device before anything is processed. Clinical durations and relative dates are kept.
3. **Understand live** — incremental passes extract symptoms, medications, and safety conflicts as the conversation unfolds.
4. **Draft** — a final pass produces a SOAP note, ICD-10 coding suggestions, a medication decision trail, and a follow-up plan. Everything is a draft.
5. **Remember and act** — after clinician sign-off, the note syncs to the record, the follow-up is scheduled, and safe facts are carried into the next visit.

Hero moment to design around: an antibiotic (amoxicillin) is proposed, the patient states a
penicillin allergy, and Carry strikes the unsafe drug, flags the conflict, and tracks the
safe alternative (azithromycin) live.

Non-negotiable principles:
- **Privacy-first**: de-identification happens before processing, and the proof is visible in the transcript.
- **Review-first**: every clinical output is a draft that requires clinician sign-off. No autonomous diagnosis, no autonomous prescription. ICD-10 are suggestions only.
- **Progressive disclosure**: summary first, details on tap. Never dump raw data.
- Say "clinician review required". Never claim "HIPAA-compliant"; say "privacy-first, compliance-oriented architecture".

---

## 2. Information architecture (screens)

Bottom navigation bar with 5 tabs (persistent, calm, no decorative icons fighting the text):

1. **Today** — upcoming visit + pre-read of what Carry already knows about the patient.
2. **Live Visit** — the active listening screen: transcript, redaction proof, live clinical insight, draft.
3. **Patient** — the longitudinal record: allergies, medications, conditions, symptoms, precautions, each with provenance (which visit it came from).
4. **Timeline** — visits in chronological order with what changed in each.
5. **Knowledge Graph** — patient at center, one node per visit, captured facts wired to the visit where Carry learned them.

Tab order matches the demo narrative: Today → Live Visit → Patient → Timeline → Graph.

### 2.1 Today
- Patient identity header (name, age, reason for visit). Returning vs first consult badge.
- "Carried forward by Carry" block: known allergies (red), active medications (teal), open questions.
- Empty state when no record yet: "No record yet. Run a visit to begin." with a calm illustration, not an error.
- Primary CTA: **Begin visit** (large, accent blue).
- Secondary: ambient day schedule (a few upcoming slots) shown quietly.

### 2.2 Live Visit (the centerpiece)
- Top: a status strip with pills — Listening, Processing, Review required, Synced.
- **Transcript stream** (scrolls, newest at bottom):
  - Speaker label per turn. Person 1 = Clinician, Person 2 = Patient. Visually distinguish the two (e.g., clinician left-aligned neutral, patient right-aligned tinted bubble).
  - When a turn has no private data: one clean line.
  - When a turn has private data, show **two stacked blocks**:
    - "Captured" — original text, with the private value struck through (dashed red), tag "will be masked".
    - "Sent for processing" — sanitized text, with a red pill placeholder like `[PERSON_1]`. Tapping/long-pressing the pill shows the category (private_person, private_phone, etc.).
- **Live clinical insight panel** (below or as a draggable bottom sheet):
  - Current summary (one or two lines).
  - Medication decision trail: 1) proposed, 2) allergy/contraindication found, 3) cancelled/avoided (struck through, red), 4) current plan (teal). This is the clearest part of the screen.
  - Missing information (amber chips).
  - Safety checks (red card when there's an allergy conflict).
- **Finish visit** button → runs the final pass → opens the review screen.

### 2.3 Review (modal/full screen after Finish)
- SOAP note draft (Subjective, Objective, Assessment, Plan), each section editable.
- Medication decision trail (final).
- ICD-10 suggestions as chips, marked "suggestion".
- Follow-up plan (proposed calendar event).
- Big amber banner: "Clinician review required". Two actions: **Approve and sync** / **Edit**.
- On approve: pills flip to green (Synced to Notion, Follow-up scheduled), facts get carried forward.

### 2.4 Patient
- Sectioned record: Allergies, Medications, Conditions, Symptoms, Precautions.
- Each row shows the fact + a quiet provenance chip "Visit 2".
- Empty sections show a dashed muted "No entries yet" row.

### 2.5 Timeline
- Vertical list, newest first. One card per visit: date, reason, and 2–3 "what changed" bullets (e.g., "Penicillin allergy recorded", "Switched to azithromycin").

### 2.6 Knowledge Graph
- Patient node at center. One visit node per session. Each captured fact (allergy/condition/medication/symptom) is a small node wired to the visit where it was learned.
- Color by type: allergy red, medication teal, condition accent, symptom muted.
- Tap a node → bottom sheet: "Captured in Visit N, extracted live from the conversation."
- Empty state: "Run a visit to grow the knowledge graph."
- Use a force-directed or simple radial layout. Pan and zoom. Keep it legible, not a hairball.

---

## 3. Visual system

Light theme only. Warm clinical paper background, never pure white. Restrained, premium,
enterprise-ready. No neon, no high-saturation gradients, no emoji, no em dashes in copy.

### Color tokens (define in a single theme file, ideally from OKLCH or close hex equivalents)
- `paper`  — warm off-white background (e.g. `#FAFAFB` warm-tinted).
- `surface` — slightly raised neutral panels.
- `surfaceStrong` — selected/grouped surfaces.
- `ink` — tinted near-black for primary text, never pure black.
- `inkMuted` — secondary text.
- `inkFaint` — metadata/labels.
- `line` — soft structural borders.
- `accent` — restrained blue (primary action, selected nav, active workflow).
- `accentWash` — pale blue fill.
- `teal` — medications / informational.
- `success` — muted green (completed external actions).
- `warning` — warm amber (clinician-review-required).
- `danger` — muted red (allergy conflict, cancelled/avoid, safety-critical).

Each semantic color also has a `*Wash` pale-fill variant for pill backgrounds.

### Typography
- Font: Inter (use `google_fonts` package), fall back to system.
- Page title: 28–32, weight 700–760, tight tracking (letterSpacing ~ -0.02).
- Section title: 20–22, weight 700.
- Panel/card title: 15–17, weight 700.
- Body: 14–15, weight 400–500.
- Labels/metadata: 11–12, weight 700, uppercase only for metadata, letterSpacing ~ +0.06.
- No oversized marketing hero type inside the app.

### Components
- **Status pills**: small rounded labels, ALWAYS include text not just color (Listening, Processing, Review required, Synced to Notion, Calendar proposed, Completed).
- **Cards**: soft `line` border, 14–16 radius, gentle shadow. Avoid nested cards; avoid card overload.
- **Redaction mark**: struck-through red for "captured", red wash pill for the masked placeholder.
- **Med decision trail**: a vertical 4-step stepper where the cancelled step is struck through in red and the current plan is teal.
- **Buttons**: primary filled accent; secondary ghost (text + thin border); destructive only where truly destructive.
- Motion: subtle, ease-out, 150–250ms. New transcript turns slide/fade in. No bouncy or flashy animation.

### Spacing & feel
- Generous padding (16–24), comfortable line height (1.4–1.55).
- Quiet, legible, trustworthy. A clinician should feel calm, not alerted, except where a real safety flag earns the red.

---

## 4. Architecture & data

- **State management**: Riverpod (or Bloc) — pick one and be consistent.
- **Models**: `Patient`, `Session/Visit`, `TranscriptChunk` (incomingText, sanitizedText, redactions[], speaker, speakerId), `Redaction` (value, placeholder, label, start, end), `MemoryItem` (type, value, sessionId/provenance), `SoapNote`, `MedicationDecision`, `SafetyFlag`, `FollowUp`.
- **Live data**: the live visit consumes a **stream of chunks** (mock a `Stream<TranscriptChunk>` for the demo; real version connects to the backend SSE/WebSocket). Render incrementally as chunks arrive.
- **Derive views from memory**: Patient, Timeline, and Graph must be derived from stored memory items keyed by session, not hardcoded. Fresh state is empty and builds up across visits.
- **Privacy filter**: for the demo, run a local on-device masker (regex for name/phone/email/DOB) so the masking is genuinely happening before display of the "sent for processing" block. Keep a clear seam to swap in the real model.
- **Persistence**: local store (Isar/Hive/sqflite) so a reset-to-empty and replay-from-empty works for the demo.

### Demo mode (must-have for pitching)
- A scenario picker: Visit 1 (first consult, penicillin allergy + cetirizine captured) and Visit 2 (the allergy catch: amoxicillin proposed, switched to azithromycin).
- A **Reset record** action that clears everything back to empty so the demo can replay.
- Configurable chunk pacing (e.g., 2300ms between chunks) so the live screen reads well on stage.

---

## 5. Suggested screen-by-screen build order

1. Theme + design tokens + typography + reusable pills/cards.
2. App shell with 5-tab bottom nav.
3. Models + mock chunk stream + local store.
4. Live Visit screen (transcript + dual redaction blocks + live insight + med decision trail). This is the hero; get it right first.
5. Review screen (SOAP draft + approve/sync + status pills flipping to green).
6. Today (pre-read + carried-forward + begin visit + empty state).
7. Patient record (derived from memory, with provenance chips).
8. Timeline (derived).
9. Knowledge Graph (derived, radial layout, tap-for-provenance).
10. Demo controls: scenario picker, reset, pacing.

---

## 6. Acceptance checklist

- [ ] Light, warm, premium. No neon, no emoji, no em dashes in copy.
- [ ] Live Visit shows speaker roles (Person 1 = Clinician, Person 2 = Patient) and renders both Captured and Sent-for-processing blocks when private data is present, single clean line otherwise.
- [ ] Masking visibly happens before the processed text is shown.
- [ ] Medication decision trail clearly shows proposed → conflict → cancelled (struck red) → current plan (teal).
- [ ] Allergy conflict raises a red safety card live.
- [ ] Every clinical output is labeled a draft; nothing finalizes without an explicit Approve.
- [ ] Patient, Timeline, and Graph are derived from stored memory and grow across visits; fresh state is empty.
- [ ] Reset record returns everything to empty and the demo replays from scratch.
- [ ] Status pills always carry text, never color alone.

---

## 7. Copy guardrails

- Say "clinician review required", "draft", "suggestion".
- Never "HIPAA-compliant", "magical", "autonomous diagnosis", "autonomous prescription".
- Prefer "privacy-first, compliance-oriented architecture".
- Short labels. No emoji. No em dashes.
