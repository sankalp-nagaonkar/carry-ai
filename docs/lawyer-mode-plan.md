# Carry Lawyer Mode - Plan

A second, independent profession pack for Carry. Same core pipeline as Doctor Mode
(streaming chunks, privacy filter, incremental + final passes, memory across sessions,
review-first outputs, optional actions), but every output is legal-domain native.

## Who it is for

A solo lawyer or small-firm attorney who runs back-to-back client meetings: intakes,
strategy sessions, and matter reviews. They talk, they take sparse notes, and the real
work (the memo, the deadlines, the conflict screen, the next steps) gets written up
late at night or not at all. Things slip. The most expensive thing that slips is a
limitation deadline.

## What is required

- A profession config: `config/professions/lawyer.yml` (LLM, prompts, privacy, memory types, artifacts).
- Four prompts: `prompts/lawyer/{incremental_pass,final_pass,memory_update,action_planner}.md`.
- A LawyerBrain: `src/professions/lawyer/lawyer-brain.mjs` (same shape as DoctorBrain, legal schema).
- A two-meeting simulator: `src/simulators/lawyer-transcript-simulator.mjs`.
- A dedicated demo server + UI: `src/server/lawyer-dashboard-server.mjs`, `public-lawyer/`.
- Backend routing so `profession: 'lawyer'` selects LawyerBrain.
- A Notion writer method for a legal matter memo.
- A demo command: `npm run lawyer:live` (port 5174, independent of the doctor demo on 5173).

## The doctor-to-lawyer mapping

The structure carries over one-to-one. Only the vocabulary changes.

| Doctor Mode | Lawyer Mode |
| --- | --- |
| Patient | Client / matter |
| Visit | Meeting (intake, strategy) |
| SOAP note | Matter memo (Summary, Facts, Issues, Next steps) |
| Symptoms | Key facts |
| Medication decision trail | Plan and timing decision trail |
| Allergy on file catches a contraindicated drug | A captured incident date catches a missed limitation deadline |
| Safety flags | Deadlines and conflict screen |
| ICD-10 suggestions | Issue spotting with strength |
| Follow-up plan | Next steps with owners |
| Patient memory across visits | Matter memory across meetings |

## The hero moment (mirrors the allergy catch)

In Meeting 1 the client states the dismissal date (March 3). Carry stores it and computes
the employment tribunal limitation deadline (three months, around June 3).

In Meeting 2 the client proposes filing "in August, no rush." Carry pulls the stored date
from memory, strikes the August plan as past the statutory deadline, raises a high-urgency
deadline flag, and proposes filing now. A real, expensive mistake caught from memory, live.

## What it unlocks for the lawyer

- A written matter memo drafted before they leave the room, ready to review and sign off.
- A live deadline guardrail. Limitation periods are computed from captured dates and tracked, not remembered by luck.
- A standing conflict-of-interest register built from every party named across meetings.
- Issue spotting surfaced as the conversation happens, so nothing obvious is missed.
- Clear next steps with owners (attorney, client, paralegal) and a billable-time summary.
- Matter memory that carries opposing parties, dates, issues, and objectives into the next meeting.

## What is beneficial about doing it in Carry

- Privacy-first by construction: client identifiers are masked on device before anything is processed, while legal entities and facts are preserved for meaning.
- Review-first by construction: nothing is advice, nothing is filed, nothing is sent. Every artifact is a draft the attorney approves.
- Memory is the moat: the value compounds across meetings. The deadline catch is only possible because Meeting 1 was remembered.

## User journey

1. Before the meeting, the attorney opens Today and sees a matter pre-read built from earlier meetings: opposing parties, open issues, and any approaching deadlines in red.
2. They start the meeting. The live transcript streams in, client identifiers masked, while Carry spots issues, captures facts, and tracks dates and timing in real time.
3. The hero: the client proposes a relaxed filing timeline; Carry strikes it and raises the limitation deadline pulled from the prior meeting.
4. At the end, Carry drafts the matter memo, the deadline list, the conflict screen, and the next steps. The attorney reviews and approves.
5. The memo syncs to Notion, the deadline is proposed as a calendar reminder, and the matter memory grows. The next meeting starts from everything Carry already knows.

## Guardrails

- Not legal advice. Every output is a draft requiring attorney review.
- No autonomous filing, service, or client communication.
- Deadlines are computed suggestions and must be verified against the governing rules and jurisdiction.
- Conflict screening is a prompt to run the firm process, not a clearance.
- Copy stays plain. No decorative symbols, no long dash punctuation, no hype.
