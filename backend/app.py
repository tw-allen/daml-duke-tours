import os
import re
from typing import Optional
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from openai import OpenAI
from fastapi.middleware.cors import CORSMiddleware
import psycopg2
from psycopg2.extras import RealDictCursor
import requests
from bs4 import BeautifulSoup


# ----------------------------
# Load Environment Variables
# ----------------------------
load_dotenv()

DUKE_API_KEY = os.getenv("DUKE_AI_API_KEY")
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://postgres:password@localhost:5433/postgres"
)
ENABLE_LLM_RESEARCH = os.getenv("ENABLE_LLM_RESEARCH", "true").lower() == "true"

if not DUKE_API_KEY:
    print("Warning: DUKE_AI_API_KEY not found. Falling back to simple blurbs.")

blurb_cache = {}
web_context_cache = {}
web_fact_cache = {}
research_cache = {}

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

# ----------------------------
# Database Helpers
# ----------------------------
def get_db_connection():
    return psycopg2.connect(DATABASE_URL, cursor_factory=RealDictCursor)


def slugify(text: Optional[str]) -> str:
    if not text:
        return ""

    normalized = []
    previous_was_separator = False

    for char in text.strip().lower():
        if char.isalnum():
            normalized.append(char)
            previous_was_separator = False
        elif not previous_was_separator:
            normalized.append("_")
            previous_was_separator = True

    return "".join(normalized).strip("_")


def parse_csv_text(value: Optional[str]) -> list[str]:
    if not value:
        return []

    return [item.strip() for item in value.split(",") if item.strip()]


def normalize_building_record(row: dict) -> dict:
    notable_features = parse_csv_text(row.get("notable_features"))
    aliases = parse_csv_text(row.get("aliases"))

    return {
        "id": str(row["id"]),
        "slug": slugify(row.get("name")),
        "name": row.get("name", ""),
        "official_name": row.get("official_name"),
        "aliases": aliases,
        "campus": row.get("campus", ""),
        "description": row.get("description"),
        "official_url": row.get("official_url"),
        "static_facts": {
            "primary_function": row.get("primary_function", ""),
            "architecture_style": row.get("architecture_style", ""),
            "notable_features": notable_features,
        },
    }


def fetch_building(building_id: str) -> Optional[dict]:
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            if building_id.isdigit():
                cur.execute("SELECT * FROM Buildings WHERE id = %s", (int(building_id),))
                row = cur.fetchone()
                return normalize_building_record(row) if row else None

            cur.execute("SELECT * FROM Buildings")
            rows = cur.fetchall()

    requested_slug = slugify(building_id)
    for row in rows:
        building = normalize_building_record(row)
        candidate_slugs = {
            building["slug"],
            slugify(building.get("official_name")),
        }
        candidate_slugs.update(slugify(alias) for alias in building.get("aliases", []))

        if requested_slug in candidate_slugs:
            return building

    return None

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


def extract_webpage_text(url: Optional[str]) -> str:
    if not url:
        return ""

    if url in web_context_cache:
        return web_context_cache[url]

    response = requests.get(
        url,
        timeout=8,
        headers={"User-Agent": "DukeToursBot/1.0"},
    )
    response.raise_for_status()

    soup = BeautifulSoup(response.text, "html.parser")
    for tag in soup(["script", "style", "noscript", "svg", "img"]):
        tag.decompose()

    sections = []
    for element in soup.find_all(["h1", "h2", "h3", "p", "li"]):
        text = " ".join(element.get_text(" ", strip=True).split())
        if text:
            sections.append(text)

    cleaned = []
    seen = set()
    for section in sections:
        normalized = section.lower()
        if normalized in seen:
            continue
        seen.add(normalized)
        cleaned.append(section)

    page_text = " ".join(cleaned)
    page_text = re.sub(r"\s+", " ", page_text).strip()
    page_text = page_text[:2500]
    web_context_cache[url] = page_text
    return page_text


def get_building_identifiers(building: dict) -> list[str]:
    identifiers = [
        building.get("name", ""),
        building.get("official_name", ""),
    ]
    identifiers.extend(building.get("aliases", []))
    return [identifier.strip() for identifier in identifiers if identifier and identifier.strip()]


def filter_relevant_web_context(building: dict, page_text: str) -> str:
    if not page_text:
        return ""

    sentences = re.split(r"(?<=[.!?])\s+", page_text)
    identifiers = [identifier.lower() for identifier in get_building_identifiers(building)]
    keywords = [
        "building",
        "library",
        "chapel",
        "center",
        "hall",
        "tower",
        "study",
        "student",
        "dining",
        "engineering",
        "fitness",
        "recreation",
        "architecture",
    ]

    relevant = []
    for sentence in sentences:
        normalized = sentence.lower().strip()
        if not normalized:
            continue

        mentions_building = any(identifier.lower() in normalized for identifier in identifiers)
        mentions_keyword = any(keyword in normalized for keyword in keywords)

        if mentions_building or mentions_keyword:
            relevant.append(sentence.strip())

    filtered_text = " ".join(relevant[:10]).strip()
    return filtered_text[:1800]


def is_generic_page_context(building: dict, webpage_text: str) -> bool:
    if not webpage_text:
        return True

    normalized = webpage_text.lower()
    identifiers = [identifier.lower() for identifier in get_building_identifiers(building)]
    identifier_hits = sum(normalized.count(identifier) for identifier in identifiers)
    generic_markers = [
        "menu",
        "search",
        "quick links",
        "hours",
        "ask a librarian",
        "research guides",
        "contact",
        "about",
        "employment",
        "news",
    ]
    generic_hits = sum(normalized.count(marker) for marker in generic_markers)

    return identifier_hits == 0 or generic_hits >= 3


def extract_web_facts(building: dict, webpage_text: str, cache_key: Optional[str] = None) -> str:
    if not client or not webpage_text:
        return ""

    if cache_key and cache_key in web_fact_cache:
        return web_fact_cache[cache_key]

    response = client.chat.completions.create(
        model="gpt-5-nano",
        messages=[
            {
                "role": "system",
                "content": (
                    "Extract only concrete building-specific facts from official website text. "
                    "Return 2 to 4 short bullet points. If the text is generic or not clearly "
                    "about the building, return exactly: None"
                ),
            },
            {
                "role": "user",
                "content": f"""
Building: {building['name']}
Official Name: {building.get('official_name') or ''}
Aliases: {", ".join(building.get('aliases', []))}

Official website text:
{webpage_text}
""",
            },
        ],
        temperature=0.1,
    )

    extracted = response.choices[0].message.content.strip()
    if extracted.lower() == "none":
        if cache_key:
            web_fact_cache[cache_key] = ""
        return ""

    if cache_key:
        web_fact_cache[cache_key] = extracted
    return extracted


def research_building_with_web_search(building: dict) -> str:
    if not client or not ENABLE_LLM_RESEARCH:
        return ""

    cache_key = building["id"]
    if cache_key in research_cache:
        return research_cache[cache_key]

    response = client.responses.create(
        model="gpt-5-mini",
        tools=[{"type": "web_search"}],
        input=f"""
Research the Duke building below and return 2 to 4 short bullet points with only concrete,
building-specific facts that would improve a campus tour blurb.

Priorities:
1. Prefer Duke University or clearly official sources.
2. If those are sparse, use reputable secondary sources only for facts clearly about the building.
3. Ignore generic university marketing language, event listings, and navigation text.

Building: {building['name']}
Official Name: {building.get('official_name') or ''}
Aliases: {", ".join(building.get('aliases', []))}
Campus: {building.get('campus', '')}
Known facts already in database:
- Primary Function: {building.get('static_facts', {}).get('primary_function', '')}
- Architecture Style: {building.get('static_facts', {}).get('architecture_style', '')}
- Notable Features: {", ".join(building.get('static_facts', {}).get('notable_features', []))}

Rules:
- Only include facts that are clearly about this building.
- Prefer facts not already stated in the known facts above.
- If you cannot find reliable additional facts, return exactly: None
""",
    )

    researched = (response.output_text or "").strip()
    if researched.lower() == "none":
        research_cache[cache_key] = ""
        return ""

    research_cache[cache_key] = researched
    return researched

# ----------------------------
# LLM Blurb Generator
# ----------------------------
def generate_llm_blurb(building):
    if not client:
        raise Exception("No API key available")
    facts = building.get("static_facts", {})
    description = building.get("description")
    official_url = building.get("official_url")
    webpage_text = ""
    filtered_web_context = ""
    extracted_web_facts = ""
    researched_facts = ""

    if official_url:
        try:
            webpage_text = extract_webpage_text(official_url)
            filtered_web_context = filter_relevant_web_context(building, webpage_text)
            if not is_generic_page_context(building, filtered_web_context):
                extracted_web_facts = extract_web_facts(
                    building,
                    filtered_web_context,
                    cache_key=official_url,
                )
        except Exception as e:
            print("Web Retrieval Error:", e)

    try:
        researched_facts = research_building_with_web_search(building)
    except Exception as e:
        print("Research Error:", e)

    prompt = f"""
You are writing a short spoken blurb for a Duke University campus tour.

Write exactly 2 or 3 sentences that sound natural when read aloud.
The tone should be polished, welcoming, and specific, without sounding like marketing copy.
Aim to sound like an informed student guide, not a brochure.

Use only these facts:
- Building Name: {building['name']}
- Campus: {building['campus']}
- Primary Function: {facts.get('primary_function', '')}
- Architecture Style: {facts.get('architecture_style', '')}
- Notable Features: {", ".join(facts.get('notable_features', []))}
- Existing Description: {description or ''}
- Official Website: {official_url or ''}
- Filtered Official Website Context: {filtered_web_context or 'None available'}
- Extracted Web Facts: {extracted_web_facts or 'None available'}
- Additional Researched Facts: {researched_facts or 'None available'}

Rules:
- Do not invent facts.
- Do not add external knowledge.
- If additional researched facts are available, use them only if they are specific and consistent with the DB facts.
- If extracted web facts are available, use 1 or 2 of the most distinctive ones.
- Prefer specific web facts that add something new beyond the DB fields.
- Do not repeat a generic DB fact if a more vivid grounded web fact says nearly the same thing.
- If extracted web facts are available, prefer them over raw website context.
- If website context is available, use it only when it is clearly about this building.
- Treat the official website context as less reliable than the structured DB facts if they conflict.
- Do not mention every fact unless it improves the blurb.
- Prefer 1 concrete detail over a long list.
- Avoid promotional adjectives like "cutting-edge," "world-class," or "renowned" unless they are directly needed and plainly factual.
- Prefer concrete details like year completed, building layout, signature spaces, or specific student-relevant uses.
- Avoid phrases like "located on" and avoid repeating the building name more than once.
- Make it audio-tour ready.
- Do not cite or mention the website itself in the blurb.
"""

    response = client.chat.completions.create(
        model="gpt-5-nano",
        messages=[
            {"role": "system", "content": "You are a professional Duke campus tour guide."},
            {"role": "user", "content": prompt}
        ],
        temperature=0.3
    )

    return {
        "blurb": response.choices[0].message.content.strip(),
        "web_context_used": bool(filtered_web_context),
        "web_facts_used": bool(extracted_web_facts),
        "researched_facts_used": bool(researched_facts),
        "debug": {
            "official_url": official_url,
            "filtered_web_context": filtered_web_context[:500],
            "extracted_web_facts": extracted_web_facts,
            "researched_facts": researched_facts,
        },
    }

# ----------------------------
# API Endpoint
# ----------------------------
@app.post("/generate-building-blurb")
def generate_blurb(request: BuildingRequest):
    try:
        building = fetch_building(request.building_id)
    except Exception as e:
        print("Database Error:", e)
        raise HTTPException(status_code=500, detail="Unable to load building data")

    if not building:
        raise HTTPException(status_code=404, detail="Building not found")

    cache_key = request.building_id

    if cache_key in blurb_cache:
        return {
            "building_id": request.building_id,
            "blurb": blurb_cache[cache_key]["blurb"],
            "source": blurb_cache[cache_key]["source"],
            "debug": blurb_cache[cache_key].get("debug"),
            "cached": True
        }

    try:
        llm_result = generate_llm_blurb(building)
        blurb = llm_result["blurb"]
        if llm_result["researched_facts_used"]:
            source = "llm+research"
        elif llm_result["web_facts_used"]:
            source = "llm+web"
        elif llm_result["web_context_used"]:
            source = "llm+web_context"
        else:
            source = "llm"
        debug = llm_result["debug"]
    except Exception as e:
        print("LLM Error:", e)
        blurb = build_simple_blurb(building)
        source = "fallback"
        debug = None

    blurb_cache[cache_key] = {
        "blurb": blurb,
        "source": source,
        "debug": debug,
    }

    return {
        "building_id": building["id"],
        "blurb": blurb,
        "source": source,
        "debug": debug,
        "cached": False
    }
