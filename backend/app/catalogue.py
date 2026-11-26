"""Platform catalogue of pre-trained document types and their default fields of interest.

All names, companies and values used by the demo are fictional.
"""

CATALOGUE = {
    "invoice": {
        "name": "Invoice",
        "description": "Supplier tax invoice requesting payment",
        "fields": [
            # key, label, data type, mandatory
            ("invoice_number", "Invoice number", "text", True),
            ("invoice_date", "Invoice date", "date", True),
            ("due_date", "Due date", "date", False),
            ("vendor_name", "Vendor name", "text", True),
            ("vendor_address", "Vendor address", "address", False),
            ("bill_to", "Bill to", "address", False),
            ("po_number", "PO number", "text", False),
            ("subtotal", "Subtotal", "currency", False),
            ("tax", "Tax", "currency", False),
            ("total_amount", "Total amount", "currency", True),
            ("currency", "Currency", "text", False),
        ],
        "table": ["qty", "item_code", "description", "unit_price", "amount"],
    },
    "purchase_order": {
        "name": "Purchase Order",
        "description": "Buyer purchase order sent to a supplier",
        "fields": [
            ("po_number", "PO number", "text", True),
            ("po_date", "PO date", "date", True),
            ("buyer_name", "Buyer name", "text", True),
            ("supplier_name", "Supplier name", "text", True),
            ("ship_to", "Ship to", "address", False),
            ("delivery_date", "Delivery date", "date", False),
            ("payment_terms", "Payment terms", "text", False),
            ("total_amount", "Total amount", "currency", True),
            ("currency", "Currency", "text", False),
        ],
        "table": ["qty", "item_code", "description", "unit_price", "amount"],
    },
    "delivery_note": {
        "name": "Delivery Note",
        "description": "Goods delivery / packing note",
        "fields": [
            ("delivery_number", "Delivery number", "text", True),
            ("delivery_date", "Delivery date", "date", True),
            ("supplier_name", "Supplier name", "text", True),
            ("recipient", "Recipient", "text", True),
            ("delivery_address", "Delivery address", "address", False),
            ("po_number", "PO number", "text", False),
            ("carrier", "Carrier", "text", False),
            ("total_packages", "Total packages", "number", False),
        ],
        "table": ["qty", "item_code", "description"],
    },
}

VENDORS = [
    {"name": "Northwind Components", "address": "1731 N Collins St, Ste 985\nTallahassee, FL 35080", "phone": "922-331-3780"},
    {"name": "Bluepeak Logistics", "address": "44 Harbour Road\nPort Melville, WA 98012", "phone": "415-220-1182"},
    {"name": "Orion Office Supplies", "address": "9 Market Lane\nSpringfield, IL 62704", "phone": "217-555-0144"},
    {"name": "Cedar Ridge Engineering", "address": "Unit 1, 15 Ridge Circuit\nLakeview, QLD 4207", "phone": "07-5546-3420"},
    {"name": "Helix Lab Equipment", "address": "220 Science Park Dr\nBoulder, CO 80301", "phone": "303-555-0199"},
    {"name": "Summit Packaging Co.", "address": "78 Industrial Way\nAkron, OH 44308", "phone": "330-555-0107"},
]

BUYERS = [
    {"name": "Echomoon Holding Corp", "address": "9571 South Meridian Blvd\nInglewood, CO 80155"},
    {"name": "Lakeside Retail Group", "address": "12 Lakeside Plaza\nMadison, WI 53703"},
    {"name": "Plate Networks", "address": "1335 Joe Battle St, Suite B\nHouston, TX 79933"},
    {"name": "Granite Health Partners", "address": "500 Granite Ave\nNashua, NH 03060"},
]

ITEMS = [
    ("E-TE-TIP", "Acoustic tube earpiece tips (blue)", 28.99),
    ("TENS-P1", "Signal P-1 two-wire surveillance headset", 39.99),
    ("CBX-220", "Cardboard box frames 2x", 12.50),
    ("TRL-WLD", "Trolley weld and fabrication service", 449.00),
    ("LBL-400", "Thermal shipping labels (roll of 400)", 18.75),
    ("PLT-STD", "Standard wooden pallet", 22.00),
    ("GLV-NIT", "Nitrile gloves, box of 100", 9.80),
    ("SCN-HH2", "Handheld barcode scanner", 189.00),
    ("CBL-USB", "USB-C cable 2 m", 7.40),
    ("SHP-CHG", "Shipping charge", 29.00),
]

CARRIERS = ["FastFreight", "BlueLine Couriers", "Northern Haulage", "Metro Express"]
PAYMENT_TERMS = ["Net 30", "Net 45", "Net 60", "Due on receipt"]

REVIEWERS = [
    {"id": "JD", "name": "John Doe"},
    {"id": "AS", "name": "Anita Sharma"},
    {"id": "RK", "name": "Rahul Kumar"},
    {"id": "MP", "name": "Maria Perez"},
    {"id": "LW", "name": "Li Wei"},
]

CURRENT_USER = {"id": "CG", "name": "Chris Green", "role": "Supervisor"}


def default_config(doc_type_keys):
    """Project configuration built from catalogue defaults (CFG-10)."""
    return {
        "version": 1,
        "docTypes": [
            {
                "key": k,
                "name": CATALOGUE[k]["name"],
                "active": True,
                "fields": [
                    {"key": f[0], "label": f[1], "type": f[2], "mandatory": f[3], "threshold": None}
                    for f in CATALOGUE[k]["fields"]
                ],
                "table": list(CATALOGUE[k]["table"]),
            }
            for k in doc_type_keys
        ],
        "thresholds": {"classification": 90, "extraction": 85, "mandatory": 95},
        "sla": {"turnaroundHours": 24, "atRiskPct": 80},
        "gamification": True,
        "history": [],
    }
