INSERT INTO settings(key, value, updated_at)
VALUES ('prayer_durations', '{"Subuh":10,"Dzuhur":10,"Ashar":10,"Maghrib":10,"Isya":10,"Jumat":40}', CURRENT_TIMESTAMP)
ON CONFLICT(key) DO UPDATE SET
  value = json_set(settings.value, '$.Jumat', COALESCE(json_extract(settings.value, '$.Jumat'), 40)),
  updated_at = CURRENT_TIMESTAMP;

INSERT OR IGNORE INTO settings(key, value)
VALUES ('friday_settings', '{"theme":"Akan diumumkan","khatib":"Akan diumumkan","imam":"Akan diumumkan"}');
