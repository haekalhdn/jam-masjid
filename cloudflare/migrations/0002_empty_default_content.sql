UPDATE settings
SET value = '', updated_at = CURRENT_TIMESTAMP
WHERE key = 'ticker';
