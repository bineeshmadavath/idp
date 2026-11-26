"""SmartVision demo API (FastAPI).

Run:  uvicorn app.main:app --reload --port 8000
Docs: http://localhost:8000/docs
"""

from pathlib import Path
from typing import List, Optional

from fastapi import FastAPI, File, Form, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .service import STORE, ApiError

app = FastAPI(title="SmartVision IDP – demo API", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.middleware("http")
async def advance_clock(request: Request, call_next):
    # Simulated processing moves forward on every request.
    if request.url.path.startswith("/api"):
        STORE.tick()
    return await call_next(request)


@app.exception_handler(ApiError)
async def api_error(_: Request, exc: ApiError):
    return JSONResponse(status_code=exc.status, content={"message": exc.message, "detail": exc.detail})


# ---------------------------------------------------------------- meta & projects
@app.get("/api/meta")
def meta():
    return STORE.meta()


@app.get("/api/projects")
def list_projects():
    return STORE.list_projects()


@app.post("/api/projects")
def create_project(body: dict):
    return STORE.create_project(body)


@app.patch("/api/projects/{pid}")
def update_project(pid: str, body: dict):
    return STORE.update_project(pid, body)


# ---------------------------------------------------------------- configuration
@app.get("/api/projects/{pid}/config")
def get_config(pid: str):
    return STORE.get_config(pid)


@app.put("/api/projects/{pid}/config")
def put_config(pid: str, body: dict):
    return STORE.put_config(pid, body)


@app.post("/api/projects/{pid}/config/simulate")
def simulate(pid: str, body: dict):
    return STORE.simulate(pid, body)


# ---------------------------------------------------------------- dashboard
@app.get("/api/projects/{pid}/dashboard")
def dashboard(pid: str, request: Request):
    return STORE.dashboard(pid, dict(request.query_params))


# ---------------------------------------------------------------- documents
@app.get("/api/projects/{pid}/counts")
def counts(pid: str, request: Request):
    return STORE.counts(pid, dict(request.query_params))


@app.get("/api/projects/{pid}/batches")
def batches(pid: str, request: Request):
    return STORE.list_batches(pid, dict(request.query_params))


@app.get("/api/projects/{pid}/workload")
def workload(pid: str):
    return STORE.workload(pid)


@app.post("/api/projects/{pid}/assign")
def assign(pid: str, body: dict):
    return STORE.assign(pid, body)


@app.post("/api/projects/{pid}/upload")
async def upload(pid: str, files: List[UploadFile] = File(...), batchName: Optional[str] = Form(None)):
    # Demo: files are validated and measured, not stored or OCR'd.
    meta = []
    for f in files:
        size = 0
        while chunk := await f.read(1024 * 1024):
            size += len(chunk)
        meta.append({"name": f.filename, "size": size})
    return STORE.upload(pid, meta, batchName)


@app.get("/api/documents/{did}")
def get_document(did: str):
    return STORE.get_document(did)


@app.put("/api/documents/{did}")
def save_document(did: str, body: dict):
    return STORE.save_document(did, body)


@app.post("/api/documents/{did}/doctype")
def change_type(did: str, body: dict):
    return STORE.change_type(did, body)


@app.post("/api/documents/{did}/action")
def action(did: str, body: dict):
    return STORE.action(did, body)


# ---------------------------------------------------------------- built frontend (optional)
DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"
if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        return FileResponse(DIST / "index.html")
