import numpy as np
from PIL import Image
from transformers import CLIPProcessor, CLIPModel
import psycopg2
import os
from pgvector.psycopg2 import register_vector

# Load CLIP
model = CLIPModel.from_pretrained("openai/clip-vit-base-patch32")
processor = CLIPProcessor.from_pretrained("openai/clip-vit-base-patch32")

# Connect to DB
conn = psycopg2.connect("postgresql://postgres:password@localhost:5432/postgres")
register_vector(conn)
cur = conn.cursor()

test_folder = "test_images"

for filename in os.listdir(test_folder):
    if not filename.lower().endswith((".jpg", ".jpeg", ".png")):
        continue
    image = Image.open(os.path.join(test_folder, filename)).convert("RGB")
    inputs = processor(images=image, return_tensors="pt")
    outputs = model.vision_model(**inputs)
    vector = model.visual_projection(outputs.pooler_output).detach().numpy()[0]
    cur.execute("""
        SELECT b.name, 1 - (bi.embedding_vector <=> %s::vector) AS similarity
        FROM Building_images bi
        JOIN Buildings b ON b.id = bi.building_id
        ORDER BY bi.embedding_vector <=> %s::vector
        LIMIT 1
    """, (vector, vector))
    top = cur.fetchone()
    print(f"{filename} → {top[0]} ({top[1]:.4f})")