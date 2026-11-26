"""Simulated document AI: generates realistic document content ("truth") and a
simulated extraction result with confidence scores, the way a managed OCR /
extraction service would return it. No real OCR is performed in the demo."""

import random
import re
from datetime import datetime, timedelta

from .catalogue import BUYERS, CARRIERS, ITEMS, PAYMENT_TERMS, VENDORS

DATE_RE = re.compile(r"^\d{2}/\d{2}/\d{4}$")
CURRENCY_RE = re.compile(r"^\d+(\.\d{2})?$")
NUMBER_RE = re.compile(r"^\d+$")

OCR_CONFUSIONS = {"0": "O", "O": "0", "1": "I", "I": "1", "5": "S", "S": "5", "8": "B", "B": "8", "2": "Z", "6": "G"}


def fmt_date(ms):
    return datetime.fromtimestamp(ms / 1000).strftime("%m/%d/%Y")


def make_truth(doc_type, rng: random.Random, created_ms):
    """Generate the content printed on a document of the given type."""
    vendor = rng.choice(VENDORS)
    buyer = rng.choice(BUYERS)
    n_lines = rng.randint(2, 5)
    lines = []
    for item in rng.sample(ITEMS, n_lines):
        qty = rng.randint(1, 24)
        lines.append({
            "qty": str(qty),
            "item_code": item[0],
            "description": item[1],
            "unit_price": f"{item[2]:.2f}",
            "amount": f"{qty * item[2]:.2f}",
        })
    subtotal = round(sum(float(l["amount"]) for l in lines), 2)
    tax = round(subtotal * 0.1, 2)
    issue = created_ms - rng.randint(1, 6) * 86400000
    due = issue + rng.choice([30, 45, 60]) * 86400000
    po = f"PO-{rng.randint(10000, 99999)}"
    if doc_type == "invoice":
        v = {
            "invoice_number": f"INV{rng.randint(100000, 999999)}",
            "invoice_date": fmt_date(issue),
            "due_date": fmt_date(due),
            "vendor_name": vendor["name"],
            "vendor_address": vendor["address"],
            "bill_to": f"{buyer['name'].upper()}\nATTN: ACCOUNTS PAYABLE\n{buyer['address'].upper()}",
            "po_number": po,
            "subtotal": f"{subtotal:.2f}",
            "tax": f"{tax:.2f}",
            "total_amount": f"{subtotal + tax:.2f}",
            "currency": "USD",
        }
    elif doc_type == "purchase_order":
        v = {
            "po_number": po,
            "po_date": fmt_date(issue),
            "buyer_name": buyer["name"],
            "supplier_name": vendor["name"],
            "ship_to": buyer["address"],
            "delivery_date": fmt_date(due - 20 * 86400000),
            "payment_terms": rng.choice(PAYMENT_TERMS),
            "total_amount": f"{subtotal + tax:.2f}",
            "currency": "USD",
        }
    else:  # delivery_note
        for l in lines:
            l.pop("unit_price"); l.pop("amount")
        v = {
            "delivery_number": f"DN-{rng.randint(100000, 999999)}",
            "delivery_date": fmt_date(issue),
            "supplier_name": vendor["name"],
            "recipient": buyer["name"],
            "delivery_address": buyer["address"],
            "po_number": po,
            "carrier": rng.choice(CARRIERS),
            "total_packages": str(rng.randint(1, 12)),
        }
    return {"values": v, "lines": lines, "vendor": vendor, "buyer": buyer}


def _corrupt(value, rng):
    if not value:
        return value
    chars = list(value)
    idx = [i for i, c in enumerate(chars) if c in OCR_CONFUSIONS]
    if idx and rng.random() < 0.8:
        i = rng.choice(idx)
        chars[i] = OCR_CONFUSIONS[chars[i]]
    else:
        i = rng.randrange(len(chars))
        del chars[i]
    return "".join(chars)


def extract(truth_values, field_defs, rng: random.Random, error_rate=0.022):
    """Simulated extraction: returns {key: {value, conf, sugg}}."""
    out = {}
    for f in field_defs:
        key = f["key"]
        true_val = truth_values.get(key, "")
        r = rng.random()
        if not true_val:
            out[key] = {"value": "", "conf": round(rng.uniform(0.1, 0.4), 3), "sugg": []}
        elif r < error_rate * 0.25:  # not found
            out[key] = {"value": "", "conf": 0.0, "sugg": [true_val]}
        elif r < error_rate:  # misread
            bad = _corrupt(true_val, rng)
            alt = _corrupt(true_val, rng)
            sugg = [s for s in dict.fromkeys([true_val, alt]) if s != bad]
            out[key] = {"value": bad, "conf": round(rng.uniform(0.52, 0.83), 3), "sugg": sugg}
        elif r < error_rate * 2.2:  # correct but low confidence
            out[key] = {"value": true_val, "conf": round(rng.uniform(0.7, 0.86), 3), "sugg": [_corrupt(true_val, rng)]}
        else:
            out[key] = {"value": true_val, "conf": round(0.998 - rng.random() ** 5 * 0.07, 3), "sugg": []}
    return out


def classify_confidence(rng: random.Random):
    return round(rng.uniform(0.6, 0.88), 3) if rng.random() < 0.05 else round(rng.uniform(0.91, 0.995), 3)


def valid_format(ftype, value):
    if value == "":
        return False
    if ftype == "date":
        return bool(DATE_RE.match(value))
    if ftype == "currency":
        return bool(CURRENCY_RE.match(value))
    if ftype == "number":
        return bool(NUMBER_RE.match(value))
    return True
