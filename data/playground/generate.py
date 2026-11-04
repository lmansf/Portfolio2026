"""Generate the synthetic Owl Park sample data the "SQL source" editors query.

Everything here is made up: Owl Park is a fictional park, and the data holds no
names, emails, addresses, or card details, real or simulated. Seeded, so a rerun
gives the same files.

    python3 -m pip install duckdb numpy
    python3 data/playground/generate.py

Writes owl_park.duckdb.gz next to this script: one DuckDB database file with
four tables (park_days, products, orders, order_items), gzipped so the repo
and the download stay small. assets/sql-engine.js unzips it with the
browser's DecompressionStream and attaches it READ_ONLY as `owl_park`. It is
written in DuckDB's v1.1.0 storage format so the pinned DuckDB-Wasm (1.29.0,
DuckDB 1.1) can read it; bump STORAGE_VERSION if the engine moves to a newer
DuckDB-Wasm. The nest-box hunt's shard order follows these products' list
prices (data/console/extra.sql), so reorder the shards if the prices change.
"""

import gzip
from datetime import date, datetime, timedelta
from pathlib import Path

import duckdb
import numpy as np

OUT = Path(__file__).resolve().parent
STORAGE_VERSION = "v1.1.0"
rng = np.random.default_rng(20261102)

START, END = date(2026, 3, 1), date(2026, 8, 31)
HOLIDAYS = {date(2026, 4, 5), date(2026, 5, 25), date(2026, 7, 3), date(2026, 7, 4)}
SPRING_BREAK = (date(2026, 3, 7), date(2026, 3, 22))
CAPACITY = 1800

# product_id, name, category, list price, weekend surcharge
PRODUCTS = [
    (1, "Day Ticket (Adult)", "Ticket", 39.99, 5.00),
    (2, "Day Ticket (Child 3-11)", "Ticket", 29.99, 4.00),
    (3, "Day Ticket (Senior 65+)", "Ticket", 34.99, 4.00),
    (4, "Annual Pass", "Pass", 149.00, 0.0),
    (5, "Parking", "Add-on", 15.00, 0.0),
    (6, "Owl Encounter", "Experience", 25.00, 0.0),
    (7, "Night Flight Tour", "Experience", 35.00, 0.0),
    (8, "Meal Deal", "Food", 18.50, 0.0),
    (9, "Feather Mug", "Merch", 14.00, 0.0),
]
PRICE = {p[0]: p[3] for p in PRODUCTS}
SURCHARGE = {p[0]: p[4] for p in PRODUCTS}

CHANNELS = ["web", "mobile app", "gate"]
REGIONS = ["Tampa Bay", "Rest of Florida", "Out of state", "International"]
PAYMENTS = ["card", "digital wallet", "gift card"]

# ── Days: attendance from season, weekday, holidays, heat, and rain ──
days = []
d = START
while d <= END:
    weekend = d.weekday() >= 5
    holiday = d in HOLIDAYS
    spring = SPRING_BREAK[0] <= d <= SPRING_BREAK[1]
    month_factor = {3: 1.0, 4: 0.85, 5: 0.8, 6: 1.1, 7: 1.2, 8: 0.95}[d.month]
    high = float(
        np.clip(
            rng.normal({3: 77, 4: 82, 5: 87, 6: 90, 7: 91, 8: 91}[d.month], 3), 65, 99
        )
    )
    wet_chance = {3: 0.15, 4: 0.12, 5: 0.2, 6: 0.45, 7: 0.55, 8: 0.55}[d.month]
    rain = float(round(rng.gamma(1.4, 0.35), 2)) if rng.random() < wet_chance else 0.0
    base = (
        620
        * month_factor
        * (1.65 if weekend else 1.0)
        * (1.5 if holiday else 1.0)
        * (1.25 if spring else 1.0)
    )
    base *= 1 - min(rain, 1.5) * 0.28  # rain keeps people home
    base *= 1 - max(high - 92, 0) * 0.03  # so does extreme heat
    attendance = int(np.clip(rng.normal(base, base * 0.08), 120, CAPACITY))
    days.append(
        (d, d.strftime("%A"), weekend, holiday, round(high), rain, attendance, CAPACITY)
    )
    d += timedelta(days=1)

# ── Orders and items ──
orders, items = [], []
order_id = 100000


def add_order(visit_date, weekend, lines, channel=None, fraud=False, pass_only=False):
    global order_id
    order_id += 1
    if channel is None:
        channel = rng.choice(CHANNELS, p=[0.48, 0.30, 0.22])
    if fraud:
        channel = rng.choice(["web", "mobile app"], p=[0.8, 0.2])
    # Online orders are placed 0-21 days ahead; gate orders on the day.
    if channel == "gate":
        lead_days, hour = 0, int(rng.integers(9, 16))
    else:
        lead_days, hour = int(min(rng.exponential(4.0), 21)), int(rng.integers(0, 24))
    ordered_at = datetime.combine(
        visit_date - timedelta(days=lead_days), datetime.min.time()
    ) + timedelta(
        hours=hour, minutes=int(rng.integers(0, 60)), seconds=int(rng.integers(0, 60))
    )
    region = rng.choice(REGIONS, p=[0.46, 0.27, 0.23, 0.04])
    payment = rng.choice(PAYMENTS, p=[0.62, 0.31, 0.07])
    if fraud:
        payment = rng.choice(PAYMENTS, p=[0.55, 0.15, 0.30])
        region = rng.choice(REGIONS, p=[0.15, 0.15, 0.35, 0.35])
    if channel == "gate":
        risk = int(np.clip(rng.normal(8, 5), 0, 100))
    elif fraud:
        risk = int(np.clip(rng.normal(74, 15), 0, 100))
    else:
        risk = int(np.clip(rng.gamma(2.0, 9.0), 0, 100))
    status = (
        "declined"
        if risk >= 85
        else ("refunded" if rng.random() < 0.025 else "completed")
    )
    if fraud and status == "completed" and rng.random() < 0.4:
        status = "refunded"  # the chargeback came back
    orders.append(
        (
            order_id,
            ordered_at,
            visit_date,
            channel,
            region,
            payment,
            status,
            risk,
            fraud,
        )
    )
    for line_no, (pid, qty) in enumerate(lines, start=1):
        price = PRICE[pid] + (SURCHARGE[pid] if weekend else 0.0)
        items.append((order_id, line_no, pid, qty, round(price, 2)))


for visit_date, _, weekend, _, high, rain, attendance, _ in days:
    paying = int(attendance * rng.uniform(0.74, 0.80))  # the rest are pass holders
    sold = 0
    while sold < paying:
        adults = int(rng.choice([1, 2, 2, 2, 3, 4]))
        kids = int(rng.choice([0, 0, 1, 2, 3], p=[0.4, 0.1, 0.2, 0.2, 0.1]))
        seniors = int(rng.choice([0, 0, 0, 1, 2]))
        lines = (
            [(1, adults)]
            + ([(2, kids)] if kids else [])
            + ([(3, seniors)] if seniors else [])
        )
        if rng.random() < 0.55:
            lines.append((5, 1))
        if rng.random() < 0.18 + (0.06 if rain == 0 else 0):
            lines.append((6, int(rng.integers(1, adults + kids + 1))))
        if rng.random() < (0.12 if weekend else 0.05):
            lines.append((7, adults))
        if rng.random() < 0.35:
            lines.append((8, int(rng.integers(1, adults + kids + seniors + 1))))
        if rng.random() < 0.1:
            lines.append((9, 1))
        fraud = rng.random() < 0.012
        add_order(visit_date, weekend, lines, fraud=fraud)
        sold += adults + kids + seniors
    for _ in range(int(rng.poisson(1.6 + (2.5 if weekend else 0)))):
        add_order(
            visit_date,
            weekend,
            [(4, int(rng.choice([1, 1, 2, 2, 4])))],
            fraud=rng.random() < 0.03,
        )

con = duckdb.connect()
con.execute("""CREATE TABLE park_days (visit_date DATE, day_of_week VARCHAR,
    is_weekend BOOLEAN, is_holiday BOOLEAN, high_temp_f INTEGER, rain_inches DECIMAL(4,2),
    attendance INTEGER, capacity INTEGER)""")
con.executemany("INSERT INTO park_days VALUES (?,?,?,?,?,?,?,?)", days)
con.execute("""CREATE TABLE products (product_id INTEGER, product_name VARCHAR, category VARCHAR,
    list_price DECIMAL(8,2), weekend_surcharge DECIMAL(8,2))""")
con.executemany("INSERT INTO products VALUES (?,?,?,?,?)", PRODUCTS)
con.execute("""CREATE TABLE orders (order_id INTEGER, ordered_at TIMESTAMP, visit_date DATE,
    channel VARCHAR, guest_region VARCHAR, payment_method VARCHAR, status VARCHAR,
    risk_score INTEGER, is_fraud BOOLEAN)""")
con.executemany("INSERT INTO orders VALUES (?,?,?,?,?,?,?,?,?)", orders)
con.execute("""CREATE TABLE order_items (order_id INTEGER, line_no INTEGER, product_id INTEGER,
    quantity INTEGER, unit_price DECIMAL(8,2))""")
con.executemany("INSERT INTO order_items VALUES (?,?,?,?,?)", items)

db_path, gz_path = OUT / "owl_park.duckdb", OUT / "owl_park.duckdb.gz"
db_path.unlink(missing_ok=True)
con.execute(f"ATTACH '{db_path}' AS owl_park (STORAGE_VERSION '{STORAGE_VERSION}')")
for table, order_by in [
    ("park_days", "visit_date"),
    ("products", "product_id"),
    ("orders", "order_id"),
    ("order_items", "order_id, line_no"),
]:
    con.execute(
        f"CREATE TABLE owl_park.{table} AS SELECT * FROM {table} ORDER BY {order_by}"
    )
    n = con.execute(f"SELECT count(*) FROM owl_park.{table}").fetchone()[0]
    print(f"{table}: {n} rows")
con.execute("DETACH owl_park")
with (
    open(db_path, "rb") as src,
    open(gz_path, "wb") as raw,
    gzip.GzipFile(filename="", mode="wb", fileobj=raw, compresslevel=9, mtime=0) as gz,
):
    gz.write(src.read())
db_path.unlink()
print(f"{gz_path.name}: {gz_path.stat().st_size / 1024:.0f} KB")
