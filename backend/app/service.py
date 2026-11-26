"""SmartVision demo service layer: an in-memory store seeded with realistic
history, plus all business rules (classification, accuracy thresholds, STP,
SLA, KPIs, assignment, review actions, gamification).

The same rules are mirrored in frontend/src/mock/server.js so that the UI can
also run without this backend (hosted preview)."""

import copy
import random
import time
from pathlib import Path

from .catalogue import CATALOGUE, CURRENT_USER, REVIEWERS, default_config
from .simulator import classify_confidence, extract, make_truth, valid_format

HOUR = 3600_000
DAY = 24 * HOUR
STAGES = ["in_progress", "to_review", "approved", "rejected", "escalated", "sent"]
OPEN_STAGES = {"in_progress", "to_review", "escalated"}
DONE_STAGES = {"approved", "sent", "rejected"}
ALLOWED_EXT = {".pdf", ".png", ".jpg", ".jpeg", ".tif", ".tiff"}
MAX_FILE_MB = 20


def now_ms():
    return int(time.time() * 1000)


class ApiError(Exception):
    def __init__(self, status, message, detail=None):
        super().__init__(message)
        self.status, self.message, self.detail = status, message, detail


class Store:
    def __init__(self, seed=42, now=None):
        self.rng = random.Random(seed)
        self.live_rng = random.Random()
        self.now = now or now_ms()
        self.projects, self.batches, self.docs = {}, {}, {}
        self.seq = {"p": 0, "b": 0, "d": 0}
        self._seed()

    # ------------------------------------------------------------------ ids
    def _id(self, kind):
        self.seq[kind] += 1
        return f"{kind}{self.seq[kind]}"

    # ------------------------------------------------------------------ seed
    def _seed(self):
        specs = [
            ("Global_AP_Invoices", "Accounts payable invoices for all regions, with matching purchase orders and delivery notes.", "Ready", ["invoice", "purchase_order", "delivery_note"], 45, 3.0),
            ("Global_PO_Dummy", "Purchase orders and supplier invoices for the procurement centre of excellence.", "Ready", ["purchase_order", "invoice"], 45, 1.2),
            ("EU_Logistics_DeliveryNotes", "Delivery and packing notes from EU warehouses.", "Inprogress", ["delivery_note"], 0, 0),
            ("Legacy_Archive_2021", "Historic invoices kept for audit; scheduled for purge.", "Ready to Delete", ["invoice"], 0, 0),
            ("APAC_Vendor_Invoices", "Vendor invoices for APAC entities.", "Ready", ["invoice"], 6, 0.6),
            ("LATAM_Procurement", "Procurement documents for LATAM subsidiaries.", "Install Error", ["purchase_order"], 0, 0),
            ("NA_Freight_Bills", "Freight invoices and delivery notes for North America.", "Ready", ["invoice", "delivery_note"], 5, 0.6),
            ("Shared_Services_AP", "Accounts payable for the shared-services centre.", "Ready", ["invoice"], 4, 0.8),
            ("Retail_Supplier_POs", "Purchase orders raised by retail buying teams.", "Ready", ["purchase_order"], 4, 0.5),
            ("UK_Utilities_Invoices", "Utility and facilities invoices for UK sites.", "Ready", ["invoice"], 3, 0.7),
            ("MEA_Goods_Receipts", "Delivery notes for MEA distribution centres.", "Ready", ["delivery_note"], 3, 0.7),
            ("Pilot_Sandbox", "Sandbox project for testing new document types.", "Ready", ["invoice", "purchase_order"], 2, 1.0),
        ]
        for i, (name, desc, status, types, days, rate) in enumerate(specs):
            pid = self._id("p")
            self.projects[pid] = {
                "id": pid, "name": name, "description": desc, "status": status,
                "bookmarked": i in (0, 1), "lastModified": self.now - self.rng.randint(1, 40) * DAY,
                "createdAt": self.now - 200 * DAY, "readyAt": None,
                "config": default_config(types),
            }
            if days:
                self._seed_history(pid, days, rate)

    def _seed_history(self, pid, days, rate):
        rng = self.rng
        cfg = self.projects[pid]["config"]
        t = self.now - days * DAY
        while True:
            t += int(rng.expovariate(rate) * DAY)
            if t >= self.now - 22 * HOUR:
                break
            self._seed_batch(pid, t, rng.randint(3, 7), cfg)
        # today's intake: evenly spread so the review queue is always populated
        n_today = max(1, round(rate * 2.3))
        for k in range(n_today):
            created = self.now - int((k + 0.5) / n_today * 21 * HOUR) - rng.randint(5, 40) * 60_000
            self._seed_batch(pid, created, rng.randint(3, 6), cfg)
        # a few live batches still processing
        for k in range(2 if pid == "p1" else 1):
            created = self.now - rng.randint(1, 8) * 60_000
            self._seed_batch(pid, created, rng.randint(3, 5), cfg, live=True)

    def _seed_batch(self, pid, created, n, cfg, live=False):
        rng = self.rng
        bid = self._id("b")
        uploader = rng.choice(["CG", "CG", "JD", "AS", "RK", "System"])
        origin = rng.choices(["Direct Upload", "Email", "API"], [6, 3, 1])[0]
        if uploader == "System":
            origin = "API"
        self.batches[bid] = {
            "id": bid, "projectId": pid, "name": f"ABClient_Batch_{self.seq['b']:04d}",
            "createdAt": created, "updatedAt": created, "origin": origin, "uploadedBy": uploader,
        }
        types = [d["key"] for d in cfg["docTypes"]]
        weights = [{"invoice": 6, "purchase_order": 3, "delivery_note": 2}[k] for k in types]
        for _ in range(n):
            dtype = rng.choices(types, weights)[0]
            doc = self._new_doc(pid, bid, dtype, created + rng.randint(0, 40_000), rng)
            if live:
                doc["proc"] = "processing"
                doc["processAt"] = self.now + rng.randint(15_000, 90_000)
                if rng.random() < 0.12:
                    doc["proc"], doc["processAt"] = "failed", None
                    doc["error"] = "Page image could not be read (low resolution scan)"
            else:
                self._complete_processing(doc, doc["createdAt"] + rng.randint(60_000, 6 * 60_000), rng, history=True)
            self.docs[doc["id"]] = doc

    def _new_doc(self, pid, bid, dtype, created, rng, name=None):
        truth = make_truth(dtype, rng, created)
        v = truth["values"]
        ident = v.get("invoice_number") or v.get("po_number") or v.get("delivery_number")
        prefix = {"invoice": "Invoice", "purchase_order": "PurchaseOrder", "delivery_note": "DeliveryNote"}[dtype]
        did = self._id("d")
        return {
            "id": did, "projectId": pid, "batchId": bid,
            "name": name or f"{prefix}_{ident}.{rng.choice(['pdf', 'pdf', 'png', 'jpg'])}",
            "pages": rng.randint(1, 3), "trueType": dtype, "docType": None, "clsConf": None,
            "stage": "in_progress", "proc": "processing", "processAt": None, "error": None,
            "createdAt": created, "processedAt": None, "assignedTo": None, "assignedAt": None,
            "completedAt": None, "completedBy": None, "sentAt": None, "stp": False, "flags": [],
            "reason": None, "truth": truth, "fields": {}, "lines": [], "lineConf": [],
            "handlingSec": None, "corrections": 0, "configVersion": None,
        }

    def _type_def(self, pid, key):
        for t in self.projects[pid]["config"]["docTypes"]:
            if t["key"] == key:
                return t
        return None

    def _run_extraction(self, doc, rng):
        tdef = self._type_def(doc["projectId"], doc["docType"])
        values = doc["truth"]["values"] if doc["docType"] == doc["trueType"] else {
            k: v for k, v in doc["truth"]["values"].items()}
        doc["fields"] = extract(values, tdef["fields"], rng)
        doc["lines"] = copy.deepcopy(doc["truth"]["lines"]) if doc["docType"] == doc["trueType"] else []
        doc["lineConf"] = [round(rng.uniform(0.62, 0.84), 3) if rng.random() < 0.025 else round(rng.uniform(0.88, 0.99), 3) for _ in doc["lines"]]
        doc["configVersion"] = self.projects[doc["projectId"]]["config"]["version"]

    def _complete_processing(self, doc, at, rng, history=False):
        """Classification + extraction + STP decision (CLS-01..03, THR-04)."""
        cfg = self.projects[doc["projectId"]]["config"]
        active = [t["key"] for t in cfg["docTypes"] if t["active"]] or [cfg["docTypes"][0]["key"]]
        doc["clsConf"] = classify_confidence(rng)
        if doc["trueType"] in active:
            doc["docType"] = doc["trueType"]
        else:
            doc["docType"] = active[0]
            doc["clsConf"] = round(rng.uniform(0.4, 0.7), 3)
        self._run_extraction(doc, rng)
        doc["proc"], doc["processAt"], doc["processedAt"] = "done", None, at
        ev = self.evaluate(doc)
        if ev["stp"]:
            doc.update(stage="approved", stp=True, completedAt=at, completedBy="System")
            if history and self.now - at > 3 * HOUR:
                doc.update(stage="sent", sentAt=at + 60_000)
            elif not history:
                doc["autoSendAt"] = at + 45_000
            return
        doc["stage"] = "to_review"
        if history:
            self._seed_review(doc, at, rng)

    def _seed_review(self, doc, at, rng):
        age = self.now - doc["createdAt"]
        reviewer = rng.choice([r["id"] for r in REVIEWERS] + ["CG"])
        open_p = 0.95 if age < 22 * HOUR else 0.3 if age < 34 * HOUR else 0.06 if age < 60 * HOUR else 0
        if rng.random() < open_p:  # still open
            if rng.random() < 0.55:
                doc.update(assignedTo=reviewer, assignedAt=at + rng.randint(5, 90) * 60_000)
            if rng.random() < 0.12:
                doc.update(stage="escalated", reason="Vendor not in master data – please confirm")
            if rng.random() < 0.08:
                doc["flags"].append(rng.choice(["Resend", "Rerun"]))
            return
        assigned = at + rng.randint(5, 180) * 60_000
        span = rng.randint(10, 20 * 60) * 60_000 if rng.random() > 0.07 else rng.randint(24, 40) * HOUR
        done = min(assigned + span, self.now - 60_000)
        doc.update(assignedTo=reviewer, assignedAt=assigned, completedAt=done, completedBy=reviewer,
                   handlingSec=rng.randint(60, 420))
        r = rng.random()
        if r < 0.04:
            doc.update(stage="rejected", reason=rng.choice(["Duplicate document", "Not a valid invoice", "Illegible scan"]))
        else:
            self._apply_corrections(doc)
            if self.now - done < 3 * HOUR:
                doc.update(stage="approved")
            else:
                doc.update(stage="sent", sentAt=done + 60_000)

    def _apply_corrections(self, doc):
        ev = self.evaluate(doc)
        n = 0
        for key, f in doc["fields"].items():
            if ev["fields"][key]["status"] != "valid":
                true_val = doc["truth"]["values"].get(key, "")
                if true_val and f["value"] != true_val:
                    f["orig"], f["value"] = f["value"], true_val
                    n += 1
                f["corrected"] = True
        doc["corrections"] = n

    # ------------------------------------------------------------------ rules
    def thresholds_for(self, pid, dtype, cfg=None):
        cfg = cfg or self.projects[pid]["config"]
        tdef = next((t for t in cfg["docTypes"] if t["key"] == dtype), None)
        th = cfg["thresholds"]
        out = {}
        for f in (tdef["fields"] if tdef else []):
            base = max(th["extraction"], th["mandatory"]) if f["mandatory"] else th["extraction"]
            out[f["key"]] = f["threshold"] if f.get("threshold") is not None else base
        return out, tdef

    def evaluate(self, doc, cfg=None, use_original=False):
        """Field statuses and STP decision against the current thresholds."""
        cfg = cfg or self.projects[doc["projectId"]]["config"]
        ths, tdef = self.thresholds_for(doc["projectId"], doc["docType"], cfg)
        res, blocking, all_ok = {}, [], True
        for fdef in (tdef["fields"] if tdef else []):
            key = fdef["key"]
            f = doc["fields"].get(key, {"value": "", "conf": 0.0, "sugg": []})
            value = f.get("orig", f["value"]) if use_original else f["value"]
            corrected = f.get("corrected") and not use_original
            thr = ths[key]
            fmt_ok = valid_format(fdef["type"], value)
            if corrected and (fmt_ok or (value == "" and not fdef["mandatory"])):
                status = "valid"
            elif value == "":
                status = "error" if fdef["mandatory"] else "low"
            elif not fmt_ok:
                status = "error"
            elif f["conf"] * 100 < thr:
                status = "low"
            else:
                status = "valid"
            if status != "valid":
                all_ok = False
            if fdef["mandatory"] and status == "error":
                blocking.append(fdef["label"])
            res[key] = {"status": status, "threshold": thr}
        cls_thr = cfg["thresholds"]["classification"]
        cls_ok = (doc["clsConf"] or 0) * 100 >= cls_thr
        lines_ok = all(c * 100 >= cfg["thresholds"]["extraction"] for c in doc["lineConf"])
        return {"fields": res, "blocking": blocking, "clsOk": cls_ok,
                "stp": bool(cls_ok and all_ok and lines_ok and tdef)}

    def sla(self, doc, at=None):
        cfg = self.projects[doc["projectId"]]["config"]["sla"]
        due = doc["createdAt"] + cfg["turnaroundHours"] * HOUR
        end = doc["completedAt"] or (at or self.now)
        used = (end - doc["createdAt"]) / (cfg["turnaroundHours"] * HOUR)
        if doc["completedAt"]:
            status = "met" if end <= due else "breached"
        else:
            status = "breached" if used >= 1 else "at_risk" if used * 100 >= cfg["atRiskPct"] else "on_track"
        return {"due": due, "status": status, "remainingMs": due - (at or self.now)}

    # ------------------------------------------------------------------ clock
    def tick(self):
        """Advance simulated processing (called on every request)."""
        self.now = now_ms()
        for p in self.projects.values():
            if p["status"] == "Inprogress" and p.get("readyAt") and p["readyAt"] <= self.now:
                p["status"], p["readyAt"] = "Ready", None
        for d in self.docs.values():
            if d["proc"] == "processing" and d["processAt"] and d["processAt"] <= self.now:
                self._complete_processing(d, d["processAt"], self.live_rng)
                self.batches[d["batchId"]]["updatedAt"] = self.now
            elif d["stage"] == "approved" and d.get("autoSendAt") and d["autoSendAt"] <= self.now:
                d.update(stage="sent", sentAt=d["autoSendAt"], autoSendAt=None)

    # ------------------------------------------------------------------ meta / projects
    def meta(self):
        return {"user": CURRENT_USER, "reviewers": REVIEWERS,
                "catalogue": [{"key": k, "name": v["name"], "description": v["description"],
                               "fields": [{"key": f[0], "label": f[1], "type": f[2], "mandatory": f[3]} for f in v["fields"]],
                               "table": v["table"]} for k, v in CATALOGUE.items()]}

    def _project(self, pid):
        p = self.projects.get(pid)
        if not p:
            raise ApiError(404, "Project not found")
        return p

    def list_projects(self):
        out = []
        for p in self.projects.values():
            docs = [d for d in self.docs.values() if d["projectId"] == p["id"]]
            out.append({k: p[k] for k in ("id", "name", "description", "status", "bookmarked", "lastModified")} | {
                "documents": len(docs),
                "openDocuments": sum(d["stage"] in OPEN_STAGES for d in docs),
                "docTypes": [t["name"] for t in p["config"]["docTypes"] if t["active"]],
            })
        return out

    def create_project(self, body):
        name = (body.get("name") or "").strip()
        if not name:
            raise ApiError(400, "Project name is required")
        if any(p["name"].lower() == name.lower() for p in self.projects.values()):
            raise ApiError(400, "A project with this name already exists")
        types = [t for t in body.get("docTypes", []) if t in CATALOGUE]
        if not types:
            raise ApiError(400, "Select at least one document type")
        pid = self._id("p")
        self.projects[pid] = {"id": pid, "name": name, "description": body.get("description", ""),
                              "status": "Inprogress", "bookmarked": False, "lastModified": self.now,
                              "createdAt": self.now, "readyAt": self.now + 6000, "config": default_config(types)}
        return self.list_projects()[-1]

    def update_project(self, pid, body):
        p = self._project(pid)
        for k in ("bookmarked", "description", "name"):
            if k in body:
                p[k] = body[k]
        p["lastModified"] = self.now
        return {"ok": True}

    # ------------------------------------------------------------------ config
    def get_config(self, pid):
        return copy.deepcopy(self._project(pid)["config"])

    def put_config(self, pid, body):
        p = self._project(pid)
        cfg = copy.deepcopy(body)
        th = cfg.get("thresholds", {})
        for k in ("classification", "extraction", "mandatory"):
            v = th.get(k)
            if not isinstance(v, (int, float)) or not 0 <= v <= 100:
                raise ApiError(400, f"Threshold '{k}' must be between 0 and 100")
        for t in cfg["docTypes"]:
            if t["active"] and not t["fields"]:
                raise ApiError(400, f"Document type '{t['name']}' needs at least one field")
            for f in t["fields"]:
                if f.get("threshold") is not None and not 0 <= f["threshold"] <= 100:
                    raise ApiError(400, f"Threshold for '{f['label']}' must be between 0 and 100")
        if not any(t["active"] for t in cfg["docTypes"]):
            raise ApiError(400, "At least one document type must be active")
        cfg["version"] = p["config"]["version"] + 1
        cfg["history"] = p["config"]["history"] + [{"version": cfg["version"], "at": self.now,
                                                     "by": CURRENT_USER["name"], "note": body.get("note") or "Configuration updated"}]
        cfg.pop("note", None)
        p["config"] = cfg
        p["lastModified"] = self.now
        return self.get_config(pid)

    def simulate(self, pid, body):
        """THR-05: expected STP rate at proposed thresholds over the last 30 days."""
        p = self._project(pid)
        proposed = copy.deepcopy(p["config"])
        proposed.update({k: body[k] for k in ("thresholds", "docTypes") if k in body})
        docs = [d for d in self.docs.values() if d["projectId"] == pid and d["processedAt"]
                and d["processedAt"] >= self.now - 30 * DAY and d["docType"]]
        if not docs:
            return {"documents": 0, "currentStp": 0, "proposedStp": 0, "reviewPerDay": 0}
        cur = sum(self.evaluate(d, p["config"], use_original=True)["stp"] for d in docs)
        new = sum(self.evaluate(d, proposed, use_original=True)["stp"] for d in docs)
        return {"documents": len(docs), "currentStp": round(100 * cur / len(docs), 1),
                "proposedStp": round(100 * new / len(docs), 1), "reviewPerDay": round((len(docs) - new) / 30, 1)}

    # ------------------------------------------------------------------ listing
    def _doc_summary(self, d):
        return {"id": d["id"], "name": d["name"], "docType": d["docType"],
                "docTypeName": (self._type_def(d["projectId"], d["docType"]) or {}).get("name", "Unclassified") if d["docType"] else "Classifying…",
                "stage": d["stage"], "proc": d["proc"], "error": d["error"], "createdAt": d["createdAt"],
                "processedAt": d["processedAt"], "assignedTo": d["assignedTo"], "flags": d["flags"],
                "stp": d["stp"], "pages": d["pages"], "completedAt": d["completedAt"], "completedBy": d["completedBy"],
                "reason": d["reason"], "sla": self.sla(d)}

    def _filtered_docs(self, pid, q):
        docs = [d for d in self.docs.values() if d["projectId"] == pid]
        if q.get("q"):
            s = q["q"].lower()
            docs = [d for d in docs if s in d["name"].lower() or s in self.batches[d["batchId"]]["name"].lower()]
        if q.get("docType"):
            docs = [d for d in docs if d["docType"] == q["docType"]]
        if q.get("assignee"):
            docs = [d for d in docs if (d["assignedTo"] or "unassigned") == q["assignee"]]
        if q.get("sla"):
            docs = [d for d in docs if self.sla(d)["status"] == q["sla"]]
        if q.get("from"):
            docs = [d for d in docs if self.batches[d["batchId"]]["createdAt"] >= int(q["from"])]
        if q.get("to"):
            docs = [d for d in docs if self.batches[d["batchId"]]["createdAt"] <= int(q["to"])]
        if q.get("mine") in ("1", "true", True):
            docs = [d for d in docs if self.batches[d["batchId"]]["uploadedBy"] == CURRENT_USER["id"] or d["assignedTo"] == CURRENT_USER["id"]]
        return docs

    def counts(self, pid, q):
        self._project(pid)
        docs = self._filtered_docs(pid, q)
        return {s: len({d["batchId"] for d in docs if d["stage"] == s}) for s in STAGES} | {
            "docs": {s: sum(d["stage"] == s for d in docs) for s in STAGES}}

    def list_batches(self, pid, q):
        self._project(pid)
        stage = q.get("stage", "in_progress")
        docs = [d for d in self._filtered_docs(pid, q) if d["stage"] == stage]
        by_batch = {}
        for d in docs:
            by_batch.setdefault(d["batchId"], []).append(d)
        rows = []
        for bid, bdocs in by_batch.items():
            b = self.batches[bid]
            alld = [d for d in self.docs.values() if d["batchId"] == bid]
            rows.append(b | {
                "docs": [self._doc_summary(d) for d in sorted(bdocs, key=lambda x: x["name"])],
                "total": len(alld),
                "inProgress": sum(d["proc"] == "processing" for d in alld),
                "failed": sum(d["proc"] == "failed" for d in alld),
                "pending": sum(d["stage"] == "to_review" and d["assignedTo"] is not None for d in alld),
                "unassigned": sum(d["stage"] == "to_review" and d["assignedTo"] is None for d in alld),
                "health": "error" if any(d["proc"] == "failed" or d["stage"] == "rejected" for d in alld) else "ok",
                "updated": self.now - b["updatedAt"] < 2 * HOUR and b["updatedAt"] != b["createdAt"] or any(d["flags"] for d in bdocs),
                "modifiedOn": max([b["updatedAt"]] + [d["processedAt"] or 0 for d in alld] + [d["completedAt"] or 0 for d in alld]),
            })
        sort = q.get("sort", "createdAt")
        rev = q.get("dir", "desc") == "desc"
        rows.sort(key=lambda r: (r.get(sort) if not isinstance(r.get(sort), str) else r.get(sort).lower()), reverse=rev)
        size = int(q.get("pageSize", 10))
        pages = max(1, -(-len(rows) // size))
        page = min(max(1, int(q.get("page", 1))), pages)
        return {"rows": rows[(page - 1) * size: page * size], "page": page, "pages": pages, "total": len(rows)}

    def workload(self, pid):
        docs = [d for d in self.docs.values() if d["projectId"] == pid]
        out = []
        for r in REVIEWERS + [CURRENT_USER]:
            mine = [d for d in docs if d["assignedTo"] == r["id"]]
            out.append({"id": r["id"], "name": r["name"],
                        "assigned": sum(d["stage"] == "to_review" for d in mine),
                        "approved": sum(d["stage"] == "approved" and d["completedBy"] == r["id"] for d in mine),
                        "rejected": sum(d["stage"] == "rejected" for d in mine),
                        "escalated": sum(d["stage"] == "escalated" for d in mine),
                        "sent": sum(d["stage"] == "sent" and d["completedBy"] == r["id"] for d in mine)})
        unassigned = sum(d["stage"] == "to_review" and not d["assignedTo"] for d in docs)
        return {"reviewers": out, "unassigned": unassigned}

    def assign(self, pid, body):
        reviewer = body.get("reviewer")
        if reviewer not in {r["id"] for r in REVIEWERS} | {CURRENT_USER["id"]}:
            raise ApiError(400, "Unknown reviewer")
        n = 0
        for did in body.get("docIds", []):
            d = self.docs.get(did)
            if d and d["projectId"] == pid and d["stage"] in ("to_review", "escalated"):
                d.update(assignedTo=reviewer, assignedAt=self.now)
                self.batches[d["batchId"]]["updatedAt"] = self.now
                n += 1
        if not n:
            raise ApiError(400, "Select documents in To Review or Escalated to assign")
        return {"assigned": n}

    def upload(self, pid, files, batch_name=None, uploaded_by=None):
        p = self._project(pid)
        if p["status"] != "Ready":
            raise ApiError(400, "Project is not ready for uploads")
        if not files:
            raise ApiError(400, "Select at least one file")
        errors = []
        for f in files:
            ext = Path(f["name"]).suffix.lower()
            if ext not in ALLOWED_EXT:
                errors.append(f"{f['name']}: file type not supported")
            elif f.get("size", 0) > MAX_FILE_MB * 1024 * 1024:
                errors.append(f"{f['name']}: larger than {MAX_FILE_MB} MB")
        if errors:
            raise ApiError(400, "Some files were rejected", errors)
        bid = self._id("b")
        self.batches[bid] = {"id": bid, "projectId": pid, "name": batch_name or f"Upload_Batch_{self.seq['b']:04d}",
                             "createdAt": self.now, "updatedAt": self.now, "origin": "Direct Upload",
                             "uploadedBy": uploaded_by or CURRENT_USER["id"]}
        active = [t["key"] for t in p["config"]["docTypes"] if t["active"]]
        for i, f in enumerate(files):
            low = f["name"].lower()
            guess = "purchase_order" if "po" in low.replace("report", "") else "delivery_note" if ("delivery" in low or "dn" in low) else "invoice"
            dtype = guess if guess in active else self.live_rng.choice(active)
            d = self._new_doc(pid, bid, dtype, self.now, self.live_rng, name=f["name"])
            d["processAt"] = self.now + 4000 + i * 1500 + self.live_rng.randint(0, 3000)
            self.docs[d["id"]] = d
        p["lastModified"] = self.now
        return {"batchId": bid, "documents": len(files)}

    # ------------------------------------------------------------------ review
    def _doc(self, did):
        d = self.docs.get(did)
        if not d:
            raise ApiError(404, "Document not found")
        return d

    def get_document(self, did):
        d = self._doc(did)
        p = self.projects[d["projectId"]]
        tdef = self._type_def(d["projectId"], d["docType"]) if d["docType"] else None
        ev = self.evaluate(d) if d["docType"] else {"fields": {}, "blocking": [], "stp": False, "clsOk": False}
        fields = []
        for fdef in (tdef["fields"] if tdef else []):
            f = d["fields"].get(fdef["key"], {"value": "", "conf": 0, "sugg": []})
            fields.append(fdef | {"value": f["value"], "conf": f["conf"], "sugg": f.get("sugg", []),
                                  "orig": f.get("orig"), "corrected": bool(f.get("corrected"))} | ev["fields"].get(fdef["key"], {}))
        # navigation within the same stage (REV-20)
        same = sorted([x for x in self.docs.values() if x["projectId"] == d["projectId"] and x["stage"] == d["stage"]],
                      key=lambda x: (-self.batches[x["batchId"]]["createdAt"], x["name"]))
        ids = [x["id"] for x in same]
        bids = list(dict.fromkeys(x["batchId"] for x in same))
        i = ids.index(d["id"]) if d["id"] in ids else 0
        batch_docs = [x for x in same if x["batchId"] == d["batchId"]]
        return self._doc_summary(d) | {
            "projectId": p["id"], "projectName": p["name"], "batchName": self.batches[d["batchId"]]["name"],
            "clsConf": d["clsConf"], "clsOk": ev["clsOk"], "stpEligible": ev["stp"], "blocking": ev["blocking"],
            "fields": fields, "table": tdef["table"] if tdef else [], "lines": d["lines"],
            "lineConf": d["lineConf"], "truth": d["truth"], "trueType": d["trueType"],
            "thresholds": p["config"]["thresholds"], "docTypes": [{"key": t["key"], "name": t["name"]} for t in p["config"]["docTypes"] if t["active"]],
            "nav": {"index": i + 1, "total": len(ids), "prev": ids[i - 1] if i > 0 else None, "next": ids[i + 1] if i + 1 < len(ids) else None,
                    "batchIndex": bids.index(d["batchId"]) + 1 if d["batchId"] in bids else 1, "batchTotal": len(bids),
                    "docInBatch": [x["id"] for x in batch_docs].index(d["id"]) + 1 if d in batch_docs else 1, "batchSize": len(batch_docs),
                    "prevBatch": next((x["id"] for x in same if x["batchId"] == bids[bids.index(d["batchId"]) - 1]), None) if d["batchId"] in bids and bids.index(d["batchId"]) > 0 else None,
                    "nextBatch": next((x["id"] for x in same if x["batchId"] == bids[bids.index(d["batchId"]) + 1]), None) if d["batchId"] in bids and bids.index(d["batchId"]) + 1 < len(bids) else None},
            "configVersion": d["configVersion"], "currentConfigVersion": p["config"]["version"],
        }

    def save_document(self, did, body):
        d = self._doc(did)
        if d["stage"] not in ("to_review", "escalated"):
            raise ApiError(400, "Only documents in To Review or Escalated can be edited")
        for key, value in (body.get("fields") or {}).items():
            f = d["fields"].setdefault(key, {"value": "", "conf": 0.0, "sugg": []})
            value = str(value).strip()
            if value != f["value"]:
                if "orig" not in f:
                    f["orig"] = f["value"]
                f["value"] = value
            f["corrected"] = True
        for key in body.get("confirm") or []:
            if key in d["fields"]:
                d["fields"][key]["corrected"] = True
        if body.get("lines") is not None:
            d["lines"] = body["lines"]
            d["lineConf"] = [1.0 for _ in d["lines"]]
        d["corrections"] = sum(1 for f in d["fields"].values() if "orig" in f and f["orig"] != f["value"])
        self.batches[d["batchId"]]["updatedAt"] = self.now
        return self.get_document(did)

    def change_type(self, did, body):
        """CLS-05: reclassify and reload the new type's fields."""
        d = self._doc(did)
        new = body.get("docType")
        if not self._type_def(d["projectId"], new):
            raise ApiError(400, "Unknown document type")
        d["docType"], d["clsConf"] = new, 1.0
        d["flags"] = list(dict.fromkeys(d["flags"] + ["Reclassified"]))
        self._run_extraction(d, self.live_rng)
        return self.get_document(did)

    def action(self, did, body):
        d = self._doc(did)
        act = body.get("action")
        reason = (body.get("reason") or "").strip()
        user = CURRENT_USER["id"]
        award = None
        if act == "approve":
            if d["stage"] not in ("to_review", "escalated"):
                raise ApiError(400, "Document is not awaiting review")
            ev = self.evaluate(d)
            if ev["blocking"]:
                raise ApiError(400, "Mandatory fields are missing or invalid", ev["blocking"])
            for f in d["fields"].values():
                f["corrected"] = True
            d.update(stage="approved", completedAt=self.now, completedBy=user, assignedTo=d["assignedTo"] or user,
                     handlingSec=int(body.get("handlingSec") or 120), reason=None)
            d["autoSendAt"] = self.now + 45_000
            within = self.sla(d)["status"] == "met"
            award = {"points": 10 + (5 if within else 0), "withinSla": within}
        elif act in ("reject", "escalate"):
            if not reason:
                raise ApiError(400, "Please give a reason")
            if d["stage"] not in ("to_review", "escalated"):
                raise ApiError(400, "Document is not awaiting review")
            if act == "reject":
                d.update(stage="rejected", completedAt=self.now, completedBy=user, reason=reason)
            else:
                d.update(stage="escalated", reason=reason)
        elif act == "rerun":
            d.update(stage="in_progress", proc="processing", processAt=self.now + 6000, completedAt=None,
                     completedBy=None, stp=False, reason=None, error=None)
            for k in list(d["fields"]):
                d["fields"].pop(k)
            d["flags"] = list(dict.fromkeys([f for f in d["flags"] if f != "Resend"] + ["Rerun"]))
        elif act == "resend":
            if d["stage"] != "rejected":
                raise ApiError(400, "Only rejected documents can be resent")
            d.update(stage="to_review", completedAt=None, completedBy=None, reason=None)
            d["flags"] = list(dict.fromkeys(d["flags"] + ["Resend"]))
        elif act == "retry":
            if d["proc"] != "failed":
                raise ApiError(400, "Only failed documents can be retried")
            d.update(proc="processing", processAt=self.now + 5000, error=None)
        else:
            raise ApiError(400, "Unknown action")
        self.batches[d["batchId"]]["updatedAt"] = self.now
        return {"ok": True, "award": award, "document": self._doc_summary(d)}

    # ------------------------------------------------------------------ dashboard
    def dashboard(self, pid, q):
        p = self._project(pid)
        days = int(q.get("days", 30))
        end = self.now
        start, prev_start = end - days * DAY, end - 2 * days * DAY
        docs = [d for d in self.docs.values() if d["projectId"] == pid]
        if q.get("docType"):
            docs = [d for d in docs if d["docType"] == q["docType"]]

        def kpis(a, b):
            rec = [d for d in docs if a <= d["createdAt"] < b]
            done = [d for d in docs if d["completedAt"] and a <= d["completedAt"] < b and d["stage"] in DONE_STAGES]
            processed = [d for d in done if d["stage"] in ("approved", "sent")]
            human = [d for d in processed if not d["stp"]]
            fields_total = sum(len(d["fields"]) for d in human)
            corrected = sum(d["corrections"] for d in human)
            tat = [(d["completedAt"] - d["createdAt"]) / HOUR for d in processed]
            met = sum(self.sla(d)["status"] == "met" for d in done)
            return {
                "received": len(rec), "processed": len(processed),
                "stpRate": round(100 * sum(d["stp"] for d in processed) / len(processed), 1) if processed else 0,
                "accuracy": round(100 * (1 - corrected / fields_total), 1) if fields_total else 100,
                "turnaround": round(sum(tat) / len(tat), 1) if tat else 0,
                "slaCompliance": round(100 * met / len(done), 1) if done else 100,
                "rejectionRate": round(100 * sum(d["stage"] == "rejected" for d in done) / len(done), 1) if done else 0,
            }

        cur, prev = kpis(start, end), kpis(prev_start, start)
        open_docs = [d for d in docs if d["stage"] in OPEN_STAGES]
        sla_open = [(d, self.sla(d)) for d in open_docs if d["stage"] != "in_progress" or d["proc"] != "processing"]
        sla_counts = {s: sum(x[1]["status"] == s for x in sla_open) for s in ("on_track", "at_risk", "breached")}
        nearest = sorted(sla_open, key=lambda x: x[1]["remainingMs"])[:6]
        # daily throughput (last min(days,30) days)
        nb = min(days, 30)
        series = []
        for i in range(nb - 1, -1, -1):
            a = end - (i + 1) * DAY
            b = end - i * DAY
            series.append({"day": b, "received": sum(a <= d["createdAt"] < b for d in docs),
                           "processed": sum(bool(d["completedAt"]) and a <= d["completedAt"] < b and d["stage"] in ("approved", "sent") for d in docs)})
        weeks = []
        for i in range(11, -1, -1):
            a, b = end - (i + 1) * 7 * DAY, end - i * 7 * DAY
            pr = [d for d in docs if d["completedAt"] and a <= d["completedAt"] < b and d["stage"] in ("approved", "sent")]
            weeks.append({"week": b, "stpRate": round(100 * sum(d["stp"] for d in pr) / len(pr), 1) if pr else None})
        corr = {}
        for d in docs:
            if d["completedAt"] and d["completedAt"] >= start:
                for k, f in d["fields"].items():
                    if "orig" in f and f["orig"] != f["value"]:
                        corr[k] = corr.get(k, 0) + 1
        labels = {f["key"]: f["label"] for t in p["config"]["docTypes"] for f in t["fields"]}
        top_corr = [{"key": k, "label": labels.get(k, k), "count": v} for k, v in sorted(corr.items(), key=lambda x: -x[1])[:6]]
        mix = {}
        for d in docs:
            if d["createdAt"] >= start and d["docType"]:
                n = (self._type_def(pid, d["docType"]) or {}).get("name", d["docType"])
                mix[n] = mix.get(n, 0) + 1
        return {
            "days": days, "kpis": cur, "previous": prev,
            "backlog": len(open_docs), "unassigned": sum(d["stage"] == "to_review" and not d["assignedTo"] for d in docs),
            "pipeline": {s: sum(d["stage"] == s for d in docs) for s in STAGES},
            "sla": sla_counts | {"targetHours": p["config"]["sla"]["turnaroundHours"],
                                 "nearest": [self._doc_summary(d) | {"batchName": self.batches[d["batchId"]]["name"]} for d, _ in nearest]},
            "throughput": series, "stpTrend": weeks, "topCorrected": top_corr,
            "docTypeMix": [{"name": k, "count": v} for k, v in sorted(mix.items(), key=lambda x: -x[1])],
            "reviewers": self._reviewer_stats(docs, start),
            "lastRefreshed": self.now,
        }

    def _reviewer_stats(self, docs, start):
        out = []
        for r in REVIEWERS + [CURRENT_USER]:
            done = [d for d in docs if d["completedBy"] == r["id"] and d["completedAt"] and d["completedAt"] >= start]
            ok = [d for d in done if d["stage"] in ("approved", "sent")]
            alltime = [d for d in docs if d["completedBy"] == r["id"]]
            within = [d for d in ok if self.sla(d)["status"] == "met"]
            points = sum(10 + (5 if self.sla(d)["status"] == "met" else 0) for d in ok) + 3 * sum(d["stage"] == "rejected" for d in done)
            days_worked = sorted({int(d["completedAt"] // DAY) for d in done})
            streak, best = 0, 0
            for i, day in enumerate(days_worked):
                streak = streak + 1 if i and day - days_worked[i - 1] == 1 else 1
                best = max(best, streak)
            badges = []
            if len(alltime) >= 100:
                badges.append({"key": "century", "label": "Century", "hint": "100+ documents reviewed"})
            if len(ok) >= 10 and len(within) == len(ok):
                badges.append({"key": "sla", "label": "SLA Guardian", "hint": "No SLA breaches this period"})
            if len({d["docType"] for d in alltime}) >= 3:
                badges.append({"key": "multi", "label": "Multi-skilled", "hint": "Reviewed every document type"})
            if best >= 5:
                badges.append({"key": "streak", "label": f"{best}-day streak", "hint": "Consecutive working days"})
            open_assigned = sum(d["assignedTo"] == r["id"] and d["stage"] == "to_review" for d in docs)
            out.append({"id": r["id"], "name": r["name"], "completed": len(done), "open": open_assigned,
                        "avgHandlingSec": round(sum(d["handlingSec"] or 0 for d in done) / len(done)) if done else 0,
                        "slaMet": round(100 * len(within) / len(ok), 1) if ok else 100,
                        "points": points, "badges": badges})
        out.sort(key=lambda x: -x["points"])
        return out


STORE = Store()
