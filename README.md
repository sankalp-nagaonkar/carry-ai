# Carry

Carry is a wearable, voice-first co-pilot for professionals. It listens during
conversations and carries context forward into notes, memory, and follow-up
actions. The first profession pack is **Doctor Mode**. A second independent demo,
**Lawyer Mode**, applies the same core to attorney-client meetings.

A professional wears the capture device. Carry privacy-filters the stream,
understands the conversation as it happens, drafts the work product at the end,
remembers what matters across sessions, and prepares the follow-up work. Doctor
outputs require clinician review. Lawyer outputs require attorney review. No
automatic diagnosis, prescription, legal advice, filing, or client communication.

## What runs in this repo today

This repo is the **intelligence layer**. It ingests streaming transcript chunks
(exactly what a mic-equipped wearable would emit), processes them live, and renders
a customer-facing dashboard.

- Streaming transcript ingestion with a privacy filter as the first step
- Live incremental understanding plus an authoritative final pass
- Doctor outputs: SOAP note, missing information, safety flags, ICD-10 suggestions,
  follow-up plan, medication decision tracking
- Lawyer outputs: matter memo, issue spotting, deadline tracking, conflict screen,
  next steps, billing summary
- Longitudinal memory across visits or meetings, stored in SQLite
- A multi-visit doctor demo: Visit 1 builds the record, Visit 2 reads it back and
  catches an allergy conflict before it reaches the patient
- A multi-meeting lawyer demo: Meeting 1 captures a dismissal date, Meeting 2 reads
  it back and catches a proposed filing plan that would miss the limitation deadline
- Notion sync of the reviewed draft via Scalekit

The capture hardware is the device layer that feeds this system. In the demo, a
transcript simulator stands in for the wearable.

## Run it

```bash
npm install
cp .env.example .env   # fill in your keys
npm run live          # Doctor Mode with real POC WebSocket transcript input
npm run sim           # Doctor Mode simulator at http://localhost:5173
npm run lawyer:live   # Lawyer Mode simulator at http://localhost:5174
```

### Doctor transcript sources

Doctor Mode can run from either source:

- **Real WebSocket**: the POC global transcript API at `/v4/live/transcripts`. Set `CARRY_BACKEND_WS_URL` if you want a different ngrok URL, then run `npm run live`.
- **Simulator**: the built-in two-visit medical scenario. Use `npm run sim`.

```bash
CARRY_BACKEND_WS_URL=https://your-ngrok-url.ngrok-free.app npm run live
```

The app does not let judges switch sources from inside the UI. The command determines the experience. Simulator mode shows the Visit 1 / Visit 2 scenario controls. Real WebSocket mode shows Sam Altman as the live patient, hides simulator controls, and waits for **End visit** before running the final clinical draft.

### Doctor simulator demo flow

1. Start on Today with an empty patient record
2. Keep the picker on Visit 1, click Begin next visit
3. Watch the allergy and medication get captured live, then approve
4. The picker advances to Visit 2 and Today shows the carried-forward facts
5. Begin next visit again: the unsafe antibiotic is struck out, a safe one drafted,
   and a follow-up is prepared

Use **Reset record** (top right) to clear the patient and replay from scratch.

### Lawyer demo flow

1. Start on Today with an empty matter record
2. Keep the picker on Meeting 1, click Begin next meeting
3. Watch Carry capture the dismissal date, parties, issues, and limitation deadline
4. The picker advances to Meeting 2 and Today shows the carried-forward matter facts
5. Begin next meeting again: the relaxed August filing plan is struck as conflicting,
   the early June deadline is raised, and a corrected filing plan is drafted

Use **Reset matter** (top right) to clear the matter and replay from scratch.

### Options

```bash
PORT=8080 npm run live                 # different real doctor port
PORT=8080 npm run sim                  # different simulated doctor port
LAWYER_PORT=8081 npm run lawyer:live   # different lawyer port
SIM_DELAY_MS=2500 npm run sim          # slow simulated doctor conversation pacing
```

## Architecture

- `src/server/dashboard-server.mjs` Doctor dashboard server and SSE live endpoint
- `src/server/lawyer-dashboard-server.mjs` Lawyer dashboard server and SSE live endpoint
- `src/core/` backend, privacy filter, SQLite store
- `src/professions/doctor/` Doctor Mode brain (incremental and final passes)
- `src/professions/lawyer/` Lawyer Mode brain (incremental and final passes)
- `src/llm/` Fastrouter OpenAI-compatible client
- `src/integrations/` Scalekit and Notion writer
- `src/simulators/` transcript simulators standing in for the wearable
- `config/` app and profession YAML behavior config
- `prompts/doctor/` and `prompts/lawyer/` prompt templates
- `public/` Doctor dashboard UI
- `public-lawyer/` Lawyer dashboard UI

Secrets live in `.env`. Behavior lives in YAML under `config/`.

## Privacy

Carry uses a privacy-first, compliance-oriented architecture. Direct identifiers are
redacted before processing while clinical durations and relative dates are preserved.
Carry does not claim formal HIPAA certification.

## Status

Hackathon project. Doctor Mode and Lawyer Mode run as separate demos on the same
generic core. Additional profession packs can follow the same pattern.
