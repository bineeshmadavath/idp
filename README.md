# SmartVision IDP – version 1 demo

A working demo of the SmartVision intelligent document processing platform described in the BRD (v0.4): **React** front end, **Python FastAPI** back end, plain **HTML/CSS/JS** (no UI library). Document AI is simulated so the demo runs offline with no cloud keys.

## Run it

You need Python 3.10+ and Node.js 18+.

**1. Back end (API on port 8000)**

```bash
cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate     macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Interactive API docs: http://localhost:8000/docs

**2. Front end (port 5173, proxies `/api` to the back end)**

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173

**Other ways to run**

| Command | What it does |
|---|---|
| `npm run dev:mock` | Front end only. A built-in browser mock of the API is used, so no Python is needed. |
| `npm run build`, then start the back end | FastAPI serves the built UI too: open http://localhost:8000 |

Data lives in memory and is regenerated (about 1,000 sample documents across 12 projects) each time the back end starts.

## What to try

1. **Projects:** filter, sort, bookmark, and **Create Project**. Pick document types and their default fields of interest. The new project shows *Inprogress* and becomes *Ready* a few seconds later.
2. **Dashboard** (opens when you enter a project):
   - KPI cards with trend against the previous period: STP rate, field accuracy, turnaround, SLA compliance.
   - SLA monitor with documents closest to breach, plus pipeline, throughput and STP trend.
   - Top corrected fields, document mix, and a leaderboard with points and badges.
   - Click any KPI or bar to open the matching documents.
3. **Documents:**
   - Stage tabs: In Progress, To Review, Approved, Rejected, Escalated, Send.
   - Expandable batches, sorting, the Before / After / Between date filter, and search.
   - Hover a document name to see a preview.
   - **Upload:** use *Add sample files*, then watch the documents get classified and move out of In Progress after about 5–10 seconds.
   - **Job Assignments:** tick documents, hover a reviewer, then choose *Assign*.
4. **Review workspace:**
   - Fields are colour-coded against their thresholds: green is valid, orange is low confidence, red is missing or invalid.
   - Click a field or its box on the image to edit it inline, and pick a suggestion if one is offered.
   - Edit line-item tables.
   - Change the document type; the fields reload for the new type.
   - Save, Auto Save, Rerun, Approve, Reject or Escalate (both need a reason), and the session timeout.
   - You can't approve while a mandatory field is invalid. Approving awards points.
5. **Config:**
   - Activate or add document types and edit fields of interest: label, data type, **mandatory**, and threshold override.
   - Set project **accuracy thresholds** (classification, extraction, mandatory) and run the **impact simulation** to see the STP rate before you publish.
   - Set SLA targets and turn gamification on or off. Configuration is versioned, with history.

## Project structure

```
backend/
  app/main.py          FastAPI routes (REST, /api/*)
  app/service.py       business rules: stages, thresholds, STP, SLA, KPIs, assignment, review actions, gamification
  app/simulator.py     simulated document AI (document content + extraction with confidence scores)
  app/catalogue.py     document-type catalogue, default fields of interest, sample vendors
  app/export_seed.py   exports seeded data for the front end's mock mode
frontend/
  src/pages/           Projects, Dashboard, Documents, Review, Config
  src/components/      document renderer (SVG page + field boxes), date filter, charts, UI primitives
  src/mock/            browser mock of the API (mirrors service.py) + seed.json
  src/styles.css       all styling (tokens, micro-animations, reduced-motion support)
```

## BRD coverage (version 1 scope)

- **Covered:** project management (PRJ), project configuration (CFG, CLS, THR), project dashboard (DSH), SLA (SLA-01, 02, 04), batch listing (BAT), upload/download (UPL), date filter (FLT), job assignment (ASN), document preview (PRV), review workspace (REV), micro-interactions (NFR-20, 21, 23, 24, 27), and gamification points and badges (NFR-30, 31, 37).
- **Visible but not simulated:** New Doc and Split Doc. Search and Compare in the navigation are marked as version 2.

## Moving from demo to real

- **Real document AI:** replace `simulator.extract()` and `classify_confidence()` with calls to Azure Document Intelligence or AWS Textract. Map each field's confidence into the same `{value, conf, sugg}` shape, and the thresholds, STP, review and dashboard logic keep working.
- **Persistence:** swap the in-memory `Store` for PostgreSQL (documents, fields as JSONB, audit) and object storage for files.
- **Background processing:** move `tick()` processing to Celery workers, and SLA checks to Celery Beat, as in BRD section 10.3.
- **Security:** add SSO (OIDC) and role checks.

All company names and values in the demo are fictional sample data.
