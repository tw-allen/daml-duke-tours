CREATE TABLE Buildings(id SERIAL PRIMARY KEY, name VARCHAR(50), lat FLOAT, long FLOAT, description TEXT, address VARCHAR(255));

CREATE TABLE Building_images(image_id SERIAL PRIMARY KEY, building_id INTEGER REFERENCES Buildings(id), image_url TEXT, embedding_vector VECTOR(512));


INSERT INTO Buildings (name, lat, long, address) VALUES
    ('Perkins Library', 36.0023296117547, -78.93850852001916, 'Campus Dr, Durham, NC 27708'),
    ('Duke Chapel', 36.00226921588706, -78.94027373066305, '401 Chapel Dr, Durham, NC 27708'),
    ('Bryan Center', 36.00180620752485, -78.94168876374286, '125 Science Dr, Durham, NC 27710'),
    ('Wilson Recreation Center', 35.997692394999, -78.94130917299191, '330 Towerview Rd, Durham, NC 27708'),
    ('Wilkinson Building', 36.00358988440017, -78.93771799257846, '534 Research Dr, Durham, NC 27705'),
    ('Wu', 36.00115290473519, -78.93877717723585, '416 Chapel Dr, Durham, NC 27710');

