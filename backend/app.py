import json
import os
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from openai import OpenAI

# ----------------------------
# Load Environment Variables
# ----------------------------
load_dotenv()

DUKE_API_KEY = os.getenv("DUKE_AI_API_KEY")

if not DUKE_API_KEY:
    raise ValueError("DUKE_AI_API_KEY not found. Check your .env file.")

blurb_cache = {}

# ----------------------------
# Duke AI Gateway Client Setup
# ----------------------------
client = OpenAI(
    api_key=DUKE_API_KEY,
    base_url="https://litellm.oit.duke.edu/v1"
)

# ----------------------------
# FastAPI App
# ----------------------------
app = FastAPI()

# ----------------------------
# Request Model
# ----------------------------
class BuildingRequest(BaseModel):
    building_id: str

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
def generate_llm_blurb(building):
    facts = building.get("static_facts", {})

    prompt = f"""
You are an AI campus tour guide for Duke University.

Using ONLY the factual information provided below,
write a concise 2–4 sentence engaging building description.

Building Name: {building['name']}
Campus: {building['campus']}
Primary Function: {facts.get('primary_function', '')}
Notable Features: {", ".join(facts.get('notable_features', []))}

Do not invent facts.
Keep it friendly, informative, and suitable for a campus tour.
"""

    response = client.chat.completions.create(
        model="gpt-5-nano",
        messages=[
            {"role": "system", "content": "You are a helpful Duke campus tour guide."},
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

    # Check cache first
    if request.building_id in blurb_cache:
        return {
            "building_id": request.building_id,
            "blurb": blurb_cache[request.building_id],
            "cached": True
        }

    try:
        blurb = generate_llm_blurb(building)
    except Exception as e:
        print("LLM Error:", e)
        blurb = build_simple_blurb(building)

    blurb_cache[request.building_id] = blurb

    return {
        "building_id": building["id"],
        "blurb": blurb,
        "cached": False
    }