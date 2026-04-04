import os
import io
import re
import json
import requests
from typing import Optional
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, File, UploadFile
from pydantic import BaseModel
from openai import OpenAI
from fastapi.middleware.cors import CORSMiddleware
import numpy as np
from PIL import Image as PILImage
from transformers import CLIPProcessor, CLIPModel
import psycopg2
from psycopg2.extras import RealDictCursor
from pgvector.psycopg2 import register_vector
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
# CLIP Setup
# ----------------------------
print("Loading CLIP model...")
clip_model = CLIPModel.from_pretrained("openai/clip-vit-base-patch32")
clip_processor = CLIPProcessor.from_pretrained("openai/clip-vit-base-patch32")
print("CLIP model loaded.")

# ----------------------------
# Database Setup
# ----------------------------
db_conn = psycopg2.connect(DATABASE_URL)
register_vector(db_conn)

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
# Request Models
# ----------------------------
class BuildingRequest(BaseModel):
    building_id: str
    tour_type: Optional[str] = None


class ChatMessage(BaseModel):
    role: str
    content: str


class BuildingChatRequest(BaseModel):
    building_id: str
    message: str
    history: list[ChatMessage] = []
    current_blurb: Optional[str] = None


class GenericChatRequest(BaseModel):
    message: str
    history: list[ChatMessage] = []

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
    response = requests.get(url, timeout=8, headers={"User-Agent": "DukeToursBot/1.0"})
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
    identifiers = [building.get("name", ""), building.get("official_name", "")]
    identifiers.extend(building.get("aliases", []))
    return [i.strip() for i in identifiers if i and i.strip()]


def filter_relevant_web_context(building: dict, page_text: str) -> str:
    if not page_text:
        return ""
    sentences = re.split(r"(?<=[.!?])\s+", page_text)
    identifiers = [i.lower() for i in get_building_identifiers(building)]
    keywords = ["building", "library", "chapel", "center", "hall", "tower", "study",
                "student", "dining", "engineering", "fitness", "recreation", "architecture"]
    relevant = []
    for sentence in sentences:
        normalized = sentence.lower().strip()
        if not normalized:
            continue
        if any(i in normalized for i in identifiers) or any(k in normalized for k in keywords):
            relevant.append(sentence.strip())
    return " ".join(relevant[:10]).strip()[:1800]


def is_generic_page_context(building: dict, webpage_text: str) -> bool:
    if not webpage_text:
        return True
    normalized = webpage_text.lower()
    identifiers = [i.lower() for i in get_building_identifiers(building)]
    identifier_hits = sum(normalized.count(i) for i in identifiers)
    generic_markers = ["menu", "search", "quick links", "hours", "ask a librarian",
                       "research guides", "contact", "about", "employment", "news"]
    generic_hits = sum(normalized.count(m) for m in generic_markers)
    return identifier_hits == 0 or generic_hits >= 3


def extract_web_facts(building: dict, webpage_text: str, cache_key: Optional[str] = None) -> str:
    if not client or not webpage_text:
        return ""
    if cache_key and cache_key in web_fact_cache:
        return web_fact_cache[cache_key]
    response = client.chat.completions.create(
        model="gpt-5-nano",
        messages=[
            {"role": "system", "content": (
                "Extract only concrete building-specific facts from official website text. "
                "Return 2 to 4 short bullet points. If the text is generic or not clearly "
                "about the building, return exactly: None"
            )},
            {"role": "user", "content": f"""
Building: {building['name']}
Official Name: {building.get('official_name') or ''}
Aliases: {", ".join(building.get('aliases', []))}

Official website text:
{webpage_text}
"""},
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
def generate_llm_blurb(building, tour_type: Optional[str] = None):
    if not client:
        raise Exception("No API key available")
    facts = building.get("static_facts", {})
    description = building.get("description")
    official_url = building.get("official_url")
    filtered_web_context = ""
    extracted_web_facts = ""
    researched_facts = ""

    if official_url:
        try:
            page_text = extract_webpage_text(official_url)
            filtered_web_context = filter_relevant_web_context(building, page_text)
            if not is_generic_page_context(building, filtered_web_context):
                extracted_web_facts = extract_web_facts(building, filtered_web_context, cache_key=official_url)
        except Exception as e:
            print("Web Retrieval Error:", e)

    try:
        researched_facts = research_building_with_web_search(building)
    except Exception as e:
        print("Research Error:", e)

    if tour_type == "first_year":
        tour_context = "Focus on practical and student-life relevant details for new students."
    elif tour_type == "prospective_student":
        tour_context = "Highlight impressive aspects and academic strengths to excite prospective students."
    elif tour_type == "history":
        tour_context = "Emphasize architectural style, year built, and historical significance."
    else:
        tour_context = "Provide a general engaging campus tour description."

    prompt = f"""
You are writing a short spoken blurb for a Duke University campus tour.
{tour_context}

Write exactly 2 or 3 sentences that sound natural when read aloud.

Use only these facts:
- Building Name: {building['name']}
- Campus: {building['campus']}
- Primary Function: {facts.get('primary_function', '')}
- Architecture Style: {facts.get('architecture_style', '')}
- Notable Features: {", ".join(facts.get('notable_features', []))}
- Existing Description: {description or ''}
- Filtered Official Website Context: {filtered_web_context or 'None available'}
- Extracted Web Facts: {extracted_web_facts or 'None available'}
- Additional Researched Facts: {researched_facts or 'None available'}

Rules:
- Do not invent facts.
- Do not add external knowledge.
- Make it audio-tour ready.
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


def get_building_context(building: dict) -> dict:
    facts = building.get("static_facts", {})
    official_url = building.get("official_url")
    filtered_web_context = ""
    extracted_web_facts = ""
    researched_facts = ""

    if official_url:
        try:
            page_text = extract_webpage_text(official_url)
            filtered_web_context = filter_relevant_web_context(building, page_text)
            if not is_generic_page_context(building, filtered_web_context):
                extracted_web_facts = extract_web_facts(building, filtered_web_context, cache_key=official_url)
        except Exception as e:
            print("Web Retrieval Error:", e)

    try:
        researched_facts = research_building_with_web_search(building)
    except Exception as e:
        print("Research Error:", e)

    return {
        "primary_function": facts.get("primary_function", ""),
        "architecture_style": facts.get("architecture_style", ""),
        "notable_features": facts.get("notable_features", []),
        "description": building.get("description", ""),
        "official_url": official_url,
        "filtered_web_context": filtered_web_context,
        "extracted_web_facts": extracted_web_facts,
        "researched_facts": researched_facts,
    }


def answer_building_question(building, question, history, current_blurb=None):
    if not client:
        raise Exception("No API key available")
    context = get_building_context(building)
    serialized_history = "\n".join(f"{m.role.title()}: {m.content}" for m in history[-6:])
    already_known_facts = ""
    if current_blurb:
        try:
            already_known_facts = identify_known_facts(building, current_blurb)
        except Exception as e:
            print("Known Facts Error:", e)

    prompt = f"""
You are an interactive Duke University campus tour guide answering follow-up questions about one building.
Answer the user's question in 1 short paragraph. Be conversational, direct, and helpful.

Building context:
- Building Name: {building['name']}
- Primary Function: {context['primary_function']}
- Notable Features: {", ".join(context['notable_features'])}
- Extracted Web Facts: {context['extracted_web_facts'] or 'None'}
- Additional Researched Facts: {context['researched_facts'] or 'None'}

Recent conversation:
{serialized_history or 'None'}

Current blurb already shown:
{current_blurb or 'None'}

Facts already covered:
{already_known_facts or 'None'}

User question: {question}

Rules:
- Answer only using the building context above.
- Keep under 75 words unless asked for more detail.
- Do not restate facts already in the blurb.
"""

    response = client.chat.completions.create(
        model="gpt-5-nano",
        messages=[
            {"role": "system", "content": "You are a grounded Duke campus tour guide."},
            {"role": "user", "content": prompt},
        ],
        temperature=0.3,
    )
    return response.choices[0].message.content.strip()


def identify_known_facts(building: dict, current_blurb: str) -> str:
    if not client or not current_blurb:
        return ""
    context = get_building_context(building)
    response = client.chat.completions.create(
        model="gpt-5-nano",
        messages=[
            {"role": "system", "content": (
                "Identify which building facts are already stated in the provided blurb. "
                "Return 3 to 6 short bullet points. If the blurb is too vague, return exactly: None"
            )},
            {"role": "user", "content": f"""
Building: {building['name']}
Known context:
- Primary Function: {context['primary_function']}
- Notable Features: {", ".join(context['notable_features'])}

Current blurb:
{current_blurb}
"""},
        ],
        temperature=0.1,
    )
    known_facts = response.choices[0].message.content.strip()
    return "" if known_facts.lower() == "none" else known_facts

# ----------------------------
# Endpoints
# ----------------------------
@app.post("/chat")
def generic_chat(request: GenericChatRequest):
    if not request.message.strip():
        raise HTTPException(status_code=400, detail="Message is required")
    if not client:
        raise HTTPException(status_code=503, detail="Chat backend unavailable: missing API key")

    history = request.history[-12:]
    messages = [{"role": "system", "content": "You are a friendly Duke campus tour assistant. Keep answers concise and helpful."}]
    messages.extend({"role": m.role, "content": m.content} for m in history)
    messages.append({"role": "user", "content": request.message})

    try:
        response = client.chat.completions.create(model="gpt-5-nano", messages=messages, temperature=0.4)
        reply = response.choices[0].message.content.strip()
    except Exception as e:
        print("Generic chat error:", e)
        raise HTTPException(status_code=500, detail="Unable to process chat message")

    return {"reply": reply}


@app.post("/generate-building-blurb")
def generate_blurb(request: BuildingRequest):
    try:
        building = fetch_building(request.building_id)
    except Exception as e:
        print("Database Error:", e)
        raise HTTPException(status_code=500, detail="Unable to load building data")

    if not building:
        raise HTTPException(status_code=404, detail="Building not found")

    cache_key = f"{request.building_id}:{request.tour_type}"

    if cache_key in blurb_cache:
        return {
            "building_id": request.building_id,
            "blurb": blurb_cache[cache_key]["blurb"],
            "source": blurb_cache[cache_key]["source"],
            "cached": True
        }

    try:
        llm_result = generate_llm_blurb(building, request.tour_type)
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

    blurb_cache[cache_key] = {"blurb": blurb, "source": source, "debug": debug}

    return {"building_id": building["id"], "blurb": blurb, "source": source, "debug": debug, "cached": False}


@app.post("/identify-building")
async def identify_building(file: UploadFile = File(...)):
    contents = await file.read()
    image = PILImage.open(io.BytesIO(contents)).convert("RGB")

    inputs = clip_processor(images=image, return_tensors="pt")
    outputs = clip_model.vision_model(**inputs)
    vector = clip_model.visual_projection(outputs.pooler_output).detach().numpy()[0]

    cur = db_conn.cursor()
    cur.execute("""
        SELECT b.id, b.name, 1 - (bi.embedding_vector <=> %s::vector) AS similarity
        FROM Building_images bi
        JOIN Buildings b ON b.id = bi.building_id
        ORDER BY bi.embedding_vector <=> %s::vector
        LIMIT 1
    """, (vector, vector))

    result = cur.fetchone()
    cur.close()

    if not result:
        raise HTTPException(status_code=404, detail="No buildings in database")

    ID_TO_SLUG = {
        1: "perkins_library",
        2: "duke_chapel",
        3: "bryan_center",
        4: "wilson_recreation_center",
        5: "wilkinson_building",
        6: "broadhead_center",
    }

    return {
        "building_id": result[0],
        "building_slug": ID_TO_SLUG.get(result[0], str(result[0])),
        "building_name": result[1],
        "similarity": float(result[2])
    }
