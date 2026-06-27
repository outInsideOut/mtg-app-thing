import os
import sys
import time
import math
import random
import threading
import requests
import urllib3
from flask import Flask, render_template, request, jsonify

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# Resolve base path whether running as script or frozen exe
BASE = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))

app = Flask(__name__, template_folder=os.path.join(BASE, "templates"),
            static_folder=os.path.join(BASE, "static"))

SCRYFALL_SEARCH = "https://api.scryfall.com/cards/search"
SCRYFALL_SETS   = "https://api.scryfall.com/sets"
HEADERS = {"User-Agent": "MTGRandomPicker/1.0 (personal local app)", "Accept": "application/json"}

PORT = 5000


def build_query(types: list, rarities: list, sets: list) -> str:
    parts = []
    if types:
        type_expr = " or ".join(f"t:{t}" for t in types)
        parts.append(f"({type_expr})" if len(types) > 1 else f"t:{types[0]}")
    if rarities:
        rarity_expr = " or ".join(f"r:{r}" for r in rarities)
        parts.append(f"({rarity_expr})" if len(rarities) > 1 else f"r:{rarities[0]}")
    if sets:
        set_expr = " or ".join(f"s:{s}" for s in sets)
        parts.append(f"({set_expr})" if len(sets) > 1 else f"s:{sets[0]}")
    return " ".join(parts) or "game:paper"


PAGE_SIZE = 175

def fetch_page(query: str, page: int):
    params = {"q": query, "page": page}
    resp = requests.get(SCRYFALL_SEARCH, params=params, headers=HEADERS, timeout=10, verify=False)
    if resp.status_code in (400, 404):
        msg = resp.json().get("details") or "No cards found matching those filters."
        return None, msg
    resp.raise_for_status()
    body = resp.json()
    return body, None


def parse_card(card: dict) -> dict:
    return {
        "id": card["id"],
        "name": card["name"],
        "mana_cost": card.get("mana_cost", ""),
        "type_line": card.get("type_line", ""),
        "set_name": card.get("set_name", ""),
        "rarity": card.get("rarity", ""),
        "image": (
            card.get("image_uris", {}).get("normal")
            or (card.get("card_faces", [{}])[0].get("image_uris", {}).get("normal"))
        ),
        "scryfall_uri": card.get("scryfall_uri", ""),
    }


def search_cards(n: int, types: list, rarities: list, sets: list):
    query = build_query(types, rarities, sets)
    try:
        # Page 1 to get total count
        body, err = fetch_page(query, 1)
        if err:
            return {"error": err}

        total = body.get("total_cards", 0)
        if total == 0:
            return {"error": "No cards found matching those filters."}

        total_pages = math.ceil(total / PAGE_SIZE)
        pages_needed = math.ceil(n / 5)
        pages_to_fetch = random.sample(range(1, total_pages + 1), min(pages_needed, total_pages))

        pool = body.get("data", [])  # page 1 already fetched

        for page in pages_to_fetch:
            if page == 1:
                continue  # already have it
            page_body, err = fetch_page(query, page)
            if err:
                break
            pool.extend(page_body.get("data", []))

        random.shuffle(pool)
        return {"cards": [parse_card(c) for c in pool]}

    except requests.RequestException as e:
        return {"error": str(e)}


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/sets")
def sets():
    try:
        resp = requests.get(SCRYFALL_SETS, headers=HEADERS, timeout=10, verify=False)
        resp.raise_for_status()
        all_sets = resp.json().get("data", [])
        expansion_sets = [
            {"name": s["name"], "code": s["code"], "released_at": s.get("released_at", "")}
            for s in all_sets
            if s.get("set_type") == "expansion"
        ]
        expansion_sets.sort(key=lambda s: s["released_at"], reverse=True)
        return jsonify(expansion_sets)
    except requests.RequestException as e:
        return jsonify({"error": str(e)}), 500


@app.route("/fetch", methods=["POST"])
def fetch():
    data = request.get_json()
    n = max(1, min(int(data.get("n", 5)), 30))
    # typed_counts: { label: { types: [...], count: N } }
    typed_counts = data.get("typed_counts", {})
    free_types   = [t.strip() for t in data.get("free_types", []) if t.strip()]
    rarities     = [r.strip() for r in data.get("rarities", []) if r.strip()]
    sets         = [s.strip() for s in data.get("sets", []) if s.strip()]

    all_cards = []
    seen_ids  = set()

    def collect(result, want):
        if "error" in result:
            return result["error"]
        added = 0
        for card in result["cards"]:
            if added >= want:
                break
            if card["id"] not in seen_ids:
                seen_ids.add(card["id"])
                all_cards.append(card)
                added += 1
        return None

    BUFFER = 1.5  # fetch extra to absorb deduplication losses

    # One search request per typed group
    for entry in typed_counts.values():
        types = entry.get("types", [])
        count = int(entry.get("count", 0))
        if count < 1:
            continue
        err = collect(search_cards(min(int(count * BUFFER) + 2, 175), types, rarities, sets), count)
        if err:
            return jsonify({"error": err})

    # One search request for remainder (free types or no type filter)
    remainder = n - len(all_cards)
    if remainder > 0:
        err = collect(search_cards(min(int(remainder * BUFFER) + 2, 175), free_types, rarities, sets), remainder)
        if err:
            return jsonify({"error": err})

    return jsonify({"cards": all_cards})


def run_flask():
    app.run(port=PORT, debug=False, use_reloader=False)


if __name__ == "__main__":
    # Dev mode: just run Flask normally
    if "--dev" in sys.argv:
        app.run(port=PORT, debug=True)
    else:
        # Production: start Flask on a background thread, open pywebview window
        import webview
        t = threading.Thread(target=run_flask, daemon=True)
        t.start()
        time.sleep(1)  # give Flask a moment to start
        webview.create_window(
            "MTG Random Card Picker",
            f"http://localhost:{PORT}",
            width=1280,
            height=860,
            resizable=True,
        )
        webview.start()
