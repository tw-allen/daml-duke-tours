import os
import numpy as np
from PIL import Image
from transformers import CLIPProcessor, CLIPModel
import psycopg2
from pgvector.psycopg2 import register_vector

# Load CLIP
model = CLIPModel.from_pretrained("openai/clip-vit-base-patch32")
processor = CLIPProcessor.from_pretrained("openai/clip-vit-base-patch32")

# Map folder names to building IDs in your DB
BUILDING_MAP = {
    "perkins":    1,
    "chapel":     2,
    "bryan":      3,
    "wilson":     4,
    "wilkinson":  5,
    "wu":         6,
}

# Connect to Postgres
conn = psycopg2.connect("postgresql://postgres:password@localhost:5432/postgres")
register_vector(conn)
cur = conn.cursor()

images_dir = "images"

for folder_name, building_id in BUILDING_MAP.items():
    folder_path = os.path.join(images_dir, folder_name)
    if not os.path.exists(folder_path):
        print(f"Folder not found: {folder_path}, skipping")
        continue

    for filename in os.listdir(folder_path):
        if not filename.lower().endswith((".jpg", ".jpeg", ".png")):
            continue

        image_path = os.path.join(folder_path, filename)
        print(f"Processing {image_path}...")

        image = Image.open(image_path).convert("RGB")
        inputs = processor(images=image, return_tensors="pt")
        outputs = model.vision_model(**inputs)
        vector = model.visual_projection(outputs.pooler_output).detach().numpy()[0]

        cur.execute(
            "INSERT INTO Building_images (building_id, image_url, embedding_vector) VALUES (%s, %s, %s)",
            (building_id, image_path, vector)
        )

conn.commit()
cur.close()
conn.close()
print("Done!")