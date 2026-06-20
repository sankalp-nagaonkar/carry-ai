# Carry

Carry is a wearable, voice-first co-pilot for professionals. It listens during
conversations and carries context forward into notes, memory, and follow-up
actions. The first profession pack is **Doctor Mode**.

A clinician wears the capture device. Carry privacy-filters the stream, understands
the conversation as it happens, drafts the clinical note at the end, remembers what
matters across visits, and prepares the follow-up work. Every clinical output is a
draft that requires clinician review. No autonomous diagnosis, no autonomous
prescription.

## What runs in this repo today

This repo is the **intelligence layer**. It ingests streaming transcript chunks
(exactly what a mic-equipped wearable would emit), processes them live, and renders
a customer-facing dashboard.

- Streaming transcript ingestion with a privacy filter as the first step
- Live incremental understanding plus an authoritative final pass
- Doctor outputs: SOAP note, missing information, safety flags, ICD-10 suggestions,
  follow-up plan, medication decision tracking
- Longitudinal memory across visits, stored in SQLite
- A multi-visit demo: Visit 1 builds the record, Visit 2 reads it back and catches
  an allergy conflict before it reaches the patient
- Notion sync of the visit note via Scalekit

The capture hardware is the device layer that feeds this system. In the demo, a
transcript simulator stands in for the wearable.

## Run it

```bash
npm install
cp .env.example .env   # fill in your keys
npm run live
```

Open http://localhost:5173

### Demo flow

1. Start on Today with an empty patient record
2. Keep the picker on Visit 1, click Begin next visit
3. Watch the allergy and medication get captured live, then approve
4. The picker advances to Visit 2 and Today shows the carried-forward facts
5. Begin next visit again: the unsafe antibiotic is struck out, a safe one drafted,
   and a follow-up is prepared

Use **Reset record** (top right) to clear the patient and replay from scratch.

### Options

```bash
PORT=8080 npm run live          # different port
SIM_DELAY_MS=2500 npm run live  # slow the conversation pacing
```

## Architecture

- `src/server/dashboard-server.mjs` dashboard server and SSE live endpoint
- `src/core/` backend, privacy filter, SQLite store
- `src/professions/doctor/` Doctor Mode brain (incremental and final passes)
- `src/llm/` Fastrouter OpenAI-compatible client
- `src/integrations/` Scalekit and Notion writer
- `src/simulators/` transcript simulator standing in for the wearable
- `config/` app and profession YAML behavior config
- `prompts/doctor/` prompt templates
- `public/` dashboard UI

Secrets live in `.env`. Behavior lives in YAML under `config/`.

## Privacy

Carry uses a privacy-first, compliance-oriented architecture. Direct identifiers are
redacted before processing while clinical durations and relative dates are preserved.
Carry does not claim formal HIPAA certification.

## Status

Hackathon project. Doctor Mode is the active profession pack. Generic core is built
to support additional profession packs.
