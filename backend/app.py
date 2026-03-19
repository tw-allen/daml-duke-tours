import json
import os
from typing import Optional
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from openai import OpenAI
from fastapi.middleware.cors import CORSMiddleware


# ----------------------------
# Load Environment Variables
# ----------------------------
load_dotenv()

DUKE_API_KEY = os.getenv("DUKE_AI_API_KEY")

if not DUKE_API_KEY:
    print("Warning: DUKE_AI_API_KEY not found. Falling back to simple blurbs.")

blurb_cache = {}

# ----------------------------
# Duke AI Gateway Client Setup
# ----------------------------
client = None
if DUKE_API_KEY:
    client = OpenAI(
        api_key=DUKE_API_KEY,
        base_url="https://litellm.oit.duke.edu/v1")

# ----------------------------
# FastAPI App
# ----------------------------
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
# ----------------------------
# Request Model
# ----------------------------
class BuildingRequest(BaseModel):
    building_id: str
    tour_type: Optional[str] = None

# ----------------------------
# Load Building Data
# ----------------------------
try:
    with open("../buildings.json", "r") as f:
        buildings_data = json.load(f)["buildings"]
except FileNotFoundError:
    raise FileNotFoundError("buildings.json not found. Check file path.")

# ----------------------------
# Simple Fallback Blurb
# ----------------------------
def build_simple_blurb(building):
    facts = building.get("static_facts", {})
    primary = facts.get("primary_function", "")
    campus = building.get("campus", "")
    features = facts.get("notable_features", [])

    feature_text = ""
    if features:
        feature_text = " Notable features include " + ", ".join(features[:2]) + "."

    return f"{building['name']} is the {primary} located on {campus}.{feature_text}".strip()

# ----------------------------
# LLM Blurb Generator
# ----------------------------
def generate_llm_blurb(building, tour_type: Optional[str] = None):
    if not client:
        raise Exception("No API key available")
    facts = building.get("static_facts", {})

    # Tour-type customization
    if tour_type == "first_year":
        tour_context = "Focus on practical and student-life relevant details for new students."
    elif tour_type == "prospective_student":
        tour_context = "Highlight impressive aspects and academic strengths to excite prospective students."
    elif tour_type == "history":
        tour_context = "Emphasize architectural style, year built, and historical significance."
    else:
        tour_context = "Provide a general engaging campus tour description."

    prompt = f"""
You are an AI campus tour guide for Duke University.

Using ONLY the factual information provided below,
write a concise 2–4 sentence engaging building description.

{tour_context}

Building Name: {building['name']}
Campus: {building['campus']}
Primary Function: {facts.get('primary_function', '')}
Notable Features: {", ".join(facts.get('notable_features', []))}

Rules:
- Do not invent facts.
- Do not add external knowledge.
- Keep it friendly and audio-tour ready.
"""

    response = client.chat.completions.create(
        model="gpt-5-nano",
        messages=[
            {"role": "system", "content": "You are a professional Duke campus tour guide."},
            {"role": "user", "content": prompt}
        ],
        temperature=0.3
    )

    return response.choices[0].message.content.strip()

# ----------------------------
# API Endpoint
# ----------------------------
@app.post("/generate-building-blurb")
def generate_blurb(request: BuildingRequest):
    building = next(
        (b for b in buildings_data if b["id"] == request.building_id),
        None
    )

    if not building:
        raise HTTPException(status_code=404, detail="Building not found")

    # Cache key now includes tour_type
    cache_key = f"{request.building_id}:{request.tour_type}"

    if cache_key in blurb_cache:
        return {
            "building_id": request.building_id,
            "tour_type": request.tour_type,
            "blurb": blurb_cache[cache_key],
            "cached": True
        }

    try:
        blurb = generate_llm_blurb(building, request.tour_type)
    except Exception as e:
        print("LLM Error:", e)
        blurb = build_simple_blurb(building)

    blurb_cache[cache_key] = blurb

    return {
        "building_id": building["id"],
        "tour_type": request.tour_type,
        "blurb": blurb,
        "cached": False
    }