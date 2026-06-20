# Doctor Mode Architecture

## 1. High-level system architecture

```mermaid
flowchart TD
    A[Omi Pendant / Mic / Upload] --> B[Transcript Source Layer]
    B --> C[Transcript Normalizer]
    C --> D[Session Builder]

    D --> E[Patient Identity Resolver]
    E --> F{Patient matched?}
    F -->|Yes| G[Patient Context Retriever / RAG]
    F -->|No / uncertain| H[Human Patient Selection]
    H --> G

    G --> I[DoctorBrain Orchestrator]
    D --> I

    subgraph DoctorBrain[DoctorBrain: Profession-specific agent layer]
        I1[Speaker Role Inference]
        I2[Clinical Fact Extraction]
        I3[SOAP Note Draft Agent]
        I4[Missing Info Agent]
        I5[Safety / Red Flag Agent]
        I6[ICD-10 Suggestion Agent]
        I7[Medication / Prescription Draft Agent]
        I8[Patient Summary Agent]
        I9[Follow-up Planner]
        I10[Patient Memory Update Agent]
        I11[Action Router]
    end

    I --> I1 --> I2 --> I3 --> I4 --> I5 --> I6 --> I7 --> I8 --> I9 --> I10 --> I11

    I11 --> J[Approval & Risk Policy Layer]
    J --> K{Approved?}
    K -->|No| L[Draft saved only]
    K -->|Yes| M[Scalekit Tool Execution]

    M --> N[Notion / EHR Draft Note]
    M --> O[Gmail Draft]
    M --> P[Google Calendar Follow-up]
    M --> Q[Google Sheets Encounter Log]
    M --> R[Future: EHR / FHIR / eRx / Patient Portal]

    I10 --> S[(Patient Memory Store)]
    G --> S

    J --> T[(Audit Log)]
    M --> T
```

---

## 2. Doctor journey architecture

```mermaid
flowchart LR
    A[Before Visit] --> B[During Visit]
    B --> C[After Visit]
    C --> D[Between Visits]
    D --> E[Future Visit]

    subgraph Before[Before Visit]
        A1[Identify patient]
        A2[Retrieve prior history]
        A3[Generate pre-visit brief]
        A4[Suggest questions]
    end

    subgraph During[During Visit]
        B1[Capture transcript]
        B2[Infer speakers]
        B3[Extract symptoms, meds, allergies]
        B4[Detect missing questions]
        B5[Detect red flags]
    end

    subgraph After[After Visit]
        C1[SOAP note draft]
        C2[ICD-10 suggestions]
        C3[Medication/prescription draft if explicitly stated]
        C4[Patient-friendly summary]
        C5[Follow-up plan]
    end

    subgraph Between[Between Visits]
        D1[Track open follow-ups]
        D2[Store patient memory]
        D3[Update timeline]
        D4[Monitor unresolved items]
    end

    subgraph Future[Future Visit]
        E1[Retrieve patient context]
        E2[Show unresolved items]
        E3[Compare current vs prior symptoms]
        E4[Update longitudinal history]
    end

    A --> A1 --> A2 --> A3 --> A4
    B --> B1 --> B2 --> B3 --> B4 --> B5
    C --> C1 --> C2 --> C3 --> C4 --> C5
    D --> D1 --> D2 --> D3 --> D4
    E --> E1 --> E2 --> E3 --> E4
```

---

## 3. Patient identity resolution + RAG flow

```mermaid
flowchart TD
    A[New transcript session] --> B[Collect identity signals]

    subgraph Signals[Identity signals]
        S1[Calendar appointment]
        S2[Clinic schedule / queue]
        S3[Doctor selected patient in app]
        S4[Patient says name / DOB / phone]
        S5[Room number / visit context]
        S6[Prior conversation continuity]
        S7[EHR encounter ID / patient portal session]
    end

    B --> S1
    B --> S2
    B --> S3
    B --> S4
    B --> S5
    B --> S6
    B --> S7

    S1 --> C[Candidate Patient Generator]
    S2 --> C
    S3 --> C
    S4 --> C
    S5 --> C
    S6 --> C
    S7 --> C

    C --> D[Patient Match Scorer]
    D --> E{Confidence}

    E -->|High| F[Attach patient_id]
    E -->|Medium| G[Show candidates to clinician]
    E -->|Low| H[Create unknown temporary encounter]

    G --> F
    H --> I[Later reconciliation]
    I --> F

    F --> J[Retrieve structured profile]
    F --> K[Retrieve prior visit summaries]
    F --> L[Retrieve open follow-ups]
    F --> M[Vector search relevant history]

    J --> N[Patient Context Pack]
    K --> N
    L --> N
    M --> N

    N --> O[DoctorBrain]
    O --> P[Generated note + actions + memory update]
    P --> Q[Clinician approval]
    Q --> R[(Patient Memory Store)]
```

---

## 4. Real-world patient identity strategy

In production, never rely only on the transcript to decide who the patient is. Use a layered identity resolver.

### Priority order

1. **Explicit EHR/appointment context**
   - The doctor opens the patient chart before/during the visit.
   - The app receives `patient_id` / `encounter_id` from EHR, calendar, or scheduling system.
   - Highest confidence.

2. **Doctor-selected patient**
   - Doctor taps/selects the current patient in the companion app.
   - Good for clinics without deep EHR integration.

3. **Schedule + time window matching**
   - Current time + doctor + room + appointment calendar.
   - Example: Dr. A has John Doe at 10:30 in Room 2.

4. **Patient-introduced identifiers**
   - Name, DOB, phone, email, patient ID mentioned in conversation.
   - Needs confirmation because speech recognition can mishear names.

5. **Conversation continuity**
   - “Last time you had a sore throat” or “your diabetes meds” can narrow candidates.
   - Useful as a signal, not enough alone.

6. **Temporary unknown encounter**
   - If uncertain, create an unassigned encounter.
   - Later attach to patient after human confirmation.

---

## 5. Patient match object

```json
{
  "session_id": "visit_001",
  "match_status": "matched_high_confidence",
  "patient_id": "patient_123",
  "encounter_id": "enc_456",
  "confidence": 0.97,
  "signals": [
    {
      "type": "calendar_match",
      "value": "Appointment with Patient A at 10:30",
      "weight": 0.45
    },
    {
      "type": "doctor_selected_patient",
      "value": "patient_123",
      "weight": 0.5
    },
    {
      "type": "transcript_identifier",
      "value": "patient said first name matches appointment",
      "weight": 0.02
    }
  ],
  "requires_human_confirmation": false
}
```

---

## 6. RAG context retrieval design

Use two kinds of retrieval:

### A. Structured retrieval

Fetch known fields directly:

```text
Patient demographics
Allergies
Active medications
Problem list
Recent diagnoses
Recent visits
Open follow-ups
Pending labs
Care plans
```

Structured retrieval should come from EHR/FHIR or your patient memory DB.

### B. Semantic retrieval

Vector search over prior conversation summaries, notes, and memory items:

```text
"sore throat"
"fever"
"medication side effects"
"follow-up from last visit"
"asthma history"
```

Semantic retrieval helps find relevant history even when exact keywords differ.

---

## 7. Patient Context Pack

Before calling DoctorBrain, construct a compact context pack.

```json
{
  "patient_id": "patient_123",
  "encounter_id": "enc_456",
  "identity_confidence": 0.97,
  "demographics": {
    "age": "not available",
    "sex": "not available"
  },
  "known_allergies": [
    {
      "value": "No known drug allergies",
      "last_confirmed": "2026-06-20",
      "source": "patient stated"
    }
  ],
  "active_medications": [],
  "problem_list": [],
  "recent_visits": [
    {
      "date": "2026-06-20",
      "summary": "Reported sore throat and fever for three days.",
      "plan": "Rest, fluids, fever medication as directed, follow-up if not improving."
    }
  ],
  "open_followups": [
    {
      "due": "2026-06-23",
      "description": "Check whether fever and sore throat improved."
    }
  ],
  "retrieved_relevant_history": [
    {
      "memory_id": "mem_001",
      "text": "Patient reported mild cough with no chest pain or difficulty breathing.",
      "relevance": 0.88,
      "source_visit": "visit_001"
    }
  ]
}
```

---

## 8. Safety rules for patient identity + RAG

1. If patient identity is uncertain, do **not** write to a permanent patient record.
2. If identity confidence is medium, generate draft notes but require clinician confirmation before attaching.
3. Never use transcript-only name matching as the sole patient identity signal.
4. Every retrieved memory item must include source, date, and confidence.
5. Patient memory updates require approval when they affect durable clinical history.
6. Do not silently convert old patient-reported information into current fact; label it as last-confirmed.

---

## 9. Hackathon version

For the demo, use a simplified version:

```text
Doctor selects patient in UI
  → system gets patient_id
  → retrieve prior Notion/JSON memory
  → process transcript
  → generate SOAP + follow-up + memory update
  → write draft to Notion
```

Avoid fully automatic patient matching in the hackathon. Show the future architecture, but demo doctor-selected patient for safety and clarity.
