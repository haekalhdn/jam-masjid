UPDATE slides
SET duration_seconds = 5, updated_at = CURRENT_TIMESTAMP
WHERE kind = 'poster';
