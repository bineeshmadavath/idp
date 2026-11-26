"""Export the seeded store as JSON for the frontend's offline mock mode.

Usage (from backend/):  python -m app.export_seed ../frontend/src/mock/seed.json
"""

import json
import sys

from .catalogue import BUYERS, CARRIERS, CATALOGUE, ITEMS, PAYMENT_TERMS, VENDORS
from .service import Store


def main(path):
    s = Store()
    data = {
        "generatedAt": s.now,
        "projects": s.projects, "batches": s.batches, "docs": s.docs, "seq": s.seq,
        "meta": s.meta(),
        "sim": {"vendors": VENDORS, "buyers": BUYERS, "items": ITEMS, "carriers": CARRIERS,
                "paymentTerms": PAYMENT_TERMS,
                "catalogueFields": {k: [list(f) for f in v["fields"]] for k, v in CATALOGUE.items()},
                "catalogueTables": {k: v["table"] for k, v in CATALOGUE.items()}},
    }
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(data, fh, separators=(",", ":"))
    print(f"Wrote {path}: {len(s.docs)} documents")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "seed.json")
