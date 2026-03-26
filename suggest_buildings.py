"""
suggest_buildings.py
--------------------
Given a GPS coordinate, returns nearby Duke buildings ranked by distance.
Uses the Haversine formula to account for Earth's curvature.

Usage (standalone test):
    python suggest_buildings.py
"""

import json
import math
from pathlib import Path


# ---------------------------------------------------------------------------
# Haversine formula
# ---------------------------------------------------------------------------

def haversine(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """
    Returns the great-circle distance in meters between two GPS coordinates.
    Accounts for Earth's curvature — accurate to ~0.5% for campus-scale distances.
    """
    R = 6_371_000  # Earth's mean radius in meters

    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lambda = math.radians(lng2 - lng1)

    a = (math.sin(d_phi / 2) ** 2
         + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2)

    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def estimate_walk_time(distance_m: float, speed_mps: float = 1.4) -> float:
    """
    Estimates walking time in minutes.
    Default speed: 1.4 m/s (~3.1 mph) — standard average walking pace.
    """
    return round(distance_m / speed_mps / 60, 1)


# ---------------------------------------------------------------------------
# Building suggestion logic
# ---------------------------------------------------------------------------

def load_buildings(json_path: str = "buildings.json") -> list[dict]:
    """Load buildings from a local JSON file."""
    path = Path(json_path)
    if not path.exists():
        raise FileNotFoundError(f"Buildings database not found at: {path.resolve()}")
    with open(path) as f:
        data = json.load(f)
    return data["buildings"]


def get_suggestions(
    user_lat: float,
    user_lng: float,
    buildings: list[dict],
    max_results: int = 5,
    max_radius_m: float = 1500,
) -> list[dict]:
    """
    Returns buildings within max_radius_m of the user, ranked by distance (closest first).

    Each result includes:
      - building metadata
      - distance_m  : straight-line distance in meters
      - eta_min     : estimated walking time in minutes
    """
    results = []

    for building in buildings:
        dist = haversine(user_lat, user_lng, building["lat"], building["lng"])

        if dist <= max_radius_m:
            results.append({
                "id": building["id"],
                "name": building["name"],
                "category": building["category"],
                "lat": building["lat"],
                "lng": building["lng"],
                "distance_m": round(dist),
                "eta_min": estimate_walk_time(dist),
                "static_facts": building.get("static_facts", {}),
            })

    # Sort closest first
    results.sort(key=lambda x: x["distance_m"])
    return results[:max_results]


# ---------------------------------------------------------------------------
# FastAPI-style route (drop this into your routes file)
# ---------------------------------------------------------------------------

# from fastapi import FastAPI
# app = FastAPI()
#
# @app.post("/api/suggest")
# def suggest(payload: dict):
#     buildings = load_buildings("buildings.json")
#     suggestions = get_suggestions(
#         user_lat=payload["lat"],
#         user_lng=payload["lng"],
#         buildings=buildings,
#         max_radius_m=payload.get("accuracy_m", 50) * 10,  # scale radius with GPS accuracy
#     )
#     return {"origin": {"lat": payload["lat"], "lng": payload["lng"]}, "suggestions": suggestions}


# ---------------------------------------------------------------------------
# Standalone test — simulates a user standing near Duke Chapel
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    # Simulated user GPS — slightly east of Duke Chapel
    USER_LAT = 36.0014
    USER_LNG = -78.9390

    print(f"User location: ({USER_LAT}, {USER_LNG})\n")
    print(f"{'Rank':<5} {'Building':<30} {'Distance':>10} {'Walk Time':>10}")
    print("-" * 60)

    buildings = load_buildings("buildings.json")
    suggestions = get_suggestions(USER_LAT, USER_LNG, buildings)

    for i, s in enumerate(suggestions, 1):
        print(f"{i:<5} {s['name']:<30} {s['distance_m']:>8}m  {s['eta_min']:>7} min")

    print("\nFull first result:")
    print(json.dumps(suggestions[0], indent=2))
