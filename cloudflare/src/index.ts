interface Env {
  DB: D1Database;
  MEDIA: R2Bucket;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  ADMIN_CLAIM_CODE?: string;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

type TelegramUser = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
};

type TelegramPhoto = { file_id: string; width: number; height: number; file_size?: number };

type TelegramMessage = {
  chat: { id: number };
  from?: TelegramUser;
  text?: string;
  caption?: string;
  photo?: TelegramPhoto[];
  document?: { file_id: string; file_name?: string; mime_type?: string; file_size?: number };
};

type TelegramUpdate = { message?: TelegramMessage };

type TelegramResponse<T> = { ok: boolean; result?: T; description?: string };
type PrayerName = "Subuh" | "Dzuhur" | "Ashar" | "Maghrib" | "Isya";
type TimingMap = Record<PrayerName, number>;
type PrayerDurationMap = TimingMap & { Jumat: number };
type FridaySettings = { theme: string; khatib: string; imam: string };

const PRAYER_NAMES: PrayerName[] = ["Subuh", "Dzuhur", "Ashar", "Maghrib", "Isya"];
const PRAYER_DURATION_NAMES = [...PRAYER_NAMES, "Jumat"] as const;
const DEFAULT_IQAMAH_DELAYS: TimingMap = {
  Subuh: 7,
  Dzuhur: 7,
  Ashar: 7,
  Maghrib: 7,
  Isya: 7,
};
const DEFAULT_PRAYER_DURATIONS: PrayerDurationMap = {
  Subuh: 10,
  Dzuhur: 10,
  Ashar: 10,
  Maghrib: 10,
  Isya: 10,
  Jumat: 40,
};
const DEFAULT_FRIDAY_SETTINGS: FridaySettings = {
  theme: "Akan diumumkan",
  khatib: "Akan diumumkan",
  imam: "Akan diumumkan",
};

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "content-type",
};

const menuKeyboard = {
  keyboard: [
    [{ text: "🖼 Tambah poster" }, { text: "🗑 Hapus poster" }],
    [{ text: "▶️ Ganti YouTube" }, { text: "🕋 Mode Jumat" }],
    [{ text: "📢 Ubah info TV" }, { text: "🧹 Sembunyikan info" }],
    [{ text: "⏱ Atur iqomah" }, { text: "🕌 Durasi sholat" }],
    [{ text: "👤 Undang admin" }, { text: "📋 Lihat konten" }],
    [{ text: "❌ Batal" }],
  ],
  resize_keyboard: true,
  is_persistent: true,
};

function json(data: unknown, status = 200, extraHeaders: HeadersInit = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...jsonHeaders, ...extraHeaders },
  });
}

function safeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

function displayName(user: TelegramUser) {
  const fullName = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
  return fullName || user.username || String(user.id);
}

async function hashInviteCode(code: string) {
  const normalized = code.trim().toUpperCase();
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalized));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function generateInviteCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return `MASJID-${[...bytes].map((byte) => alphabet[byte % alphabet.length]).join("")}`;
}

function parseTimingSetting<T extends Record<string, number>>(value: string | undefined, defaults: T): T {
  try {
    const parsed = value ? (JSON.parse(value) as Record<string, unknown>) : {};
    return Object.fromEntries(
      Object.keys(defaults).map((name) => {
        const candidate = Number(parsed[name]);
        return [name, Number.isFinite(candidate) ? candidate : defaults[name]];
      }),
    ) as T;
  } catch {
    return { ...defaults };
  }
}

function formatTimingMap(values: Record<string, number>, names: readonly string[] = PRAYER_NAMES) {
  return names.map((name) => `${name} ${values[name]} menit`).join("\n");
}

function normalizePrayerName(value: string): PrayerName | "Jumat" | null {
  const normalized = value.toLowerCase().replace(/[^a-z]/g, "");
  const names: Record<string, PrayerName | "Jumat"> = {
    subuh: "Subuh",
    dzuhur: "Dzuhur",
    zuhur: "Dzuhur",
    ashar: "Ashar",
    asar: "Ashar",
    maghrib: "Maghrib",
    magrib: "Maghrib",
    isya: "Isya",
    jumat: "Jumat",
  };
  return names[normalized] || null;
}

function parseTimingUpdates(text: string, minimum: number, maximum: number, allowedNames: readonly string[]) {
  const updates: Record<string, number> = {};
  const invalid: string[] = [];
  for (const line of text.split(/[\n,;]+/).map((part) => part.trim()).filter(Boolean)) {
    const match = line.match(/^([A-Za-z']+)\s*[:=\-]?\s*(\d{1,3})(?:\s*menit)?$/i);
    const prayer = match ? normalizePrayerName(match[1]) : null;
    const minutes = match ? Number(match[2]) : Number.NaN;
    if (!prayer || !allowedNames.includes(prayer) || !Number.isInteger(minutes) || minutes < minimum || minutes > maximum) {
      invalid.push(line);
      continue;
    }
    updates[prayer] = minutes;
  }
  return { updates, invalid };
}

function parseFridaySettings(value: string | undefined): FridaySettings {
  try {
    const parsed = value ? (JSON.parse(value) as Partial<FridaySettings>) : {};
    return {
      theme: String(parsed.theme || DEFAULT_FRIDAY_SETTINGS.theme).slice(0, 160),
      khatib: String(parsed.khatib || DEFAULT_FRIDAY_SETTINGS.khatib).slice(0, 100),
      imam: String(parsed.imam || DEFAULT_FRIDAY_SETTINGS.imam).slice(0, 100),
    };
  } catch {
    return { ...DEFAULT_FRIDAY_SETTINGS };
  }
}

function escapeHtml(value: string) {
  return value.replace(/[&<>]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[character] || character);
}

function formatFridaySettings(settings: FridaySettings) {
  return `<b>Tema</b>: ${escapeHtml(settings.theme)}\n<b>Khatib</b>: ${escapeHtml(settings.khatib)}\n<b>Imam</b>: ${escapeHtml(settings.imam)}`;
}

async function getTimingSettings(env: Env) {
  const rows = await env.DB.prepare(
    "SELECT key, value FROM settings WHERE key IN ('iqamah_delays', 'prayer_durations')",
  ).all<{ key: string; value: string }>();
  const values = Object.fromEntries(rows.results.map((row) => [row.key, row.value]));
  return {
    iqamahDelays: parseTimingSetting(values.iqamah_delays, DEFAULT_IQAMAH_DELAYS),
    prayerDurations: parseTimingSetting(values.prayer_durations, DEFAULT_PRAYER_DURATIONS),
  };
}

async function getFridaySettings(env: Env) {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'friday_settings'").first<{ value: string }>();
  return parseFridaySettings(row?.value);
}

function extractYouTubeId(input: string) {
  const trimmed = input.trim();
  if (/^[\w-]{11}$/.test(trimmed)) return trimmed;

  try {
    const url = new URL(trimmed);
    if (url.hostname === "youtu.be") return url.pathname.split("/").filter(Boolean)[0] || null;
    if (url.hostname.endsWith("youtube.com")) {
      if (url.pathname === "/watch") return url.searchParams.get("v");
      const parts = url.pathname.split("/").filter(Boolean);
      if (["embed", "shorts", "live"].includes(parts[0])) return parts[1] || null;
    }
  } catch {
    return null;
  }

  return null;
}

async function telegram<T>(env: Env, method: string, body?: Record<string, unknown>) {
  if (!env.TELEGRAM_BOT_TOKEN) throw new Error("TELEGRAM_BOT_TOKEN is not configured");
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await response.json()) as TelegramResponse<T>;
  if (!response.ok || !data.ok) throw new Error(data.description || `Telegram ${method} failed`);
  return data.result as T;
}

async function sendMessage(env: Env, chatId: number, text: string, keyboard = true) {
  await telegram(env, "sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...(keyboard ? { reply_markup: menuKeyboard } : {}),
  });
}

async function isAdmin(env: Env, userId: number) {
  const row = await env.DB.prepare(
    "SELECT telegram_user_id FROM admins WHERE telegram_user_id = ?1",
  )
    .bind(String(userId))
    .first();
  return Boolean(row);
}

async function claimAdmin(env: Env, message: TelegramMessage, code: string) {
  const user = message.from;
  if (!user) {
    await sendMessage(env, message.chat.id, "Kode aktivasi tidak sesuai.", false);
    return;
  }

  if (await isAdmin(env, user.id)) {
    await sendMessage(env, message.chat.id, "Akun ini sudah menjadi admin layar masjid.");
    return;
  }

  const count = await env.DB.prepare("SELECT COUNT(*) AS total FROM admins").first<{ total: number }>();
  const isFirstAdminCode =
    Number(count?.total || 0) === 0 &&
    Boolean(env.ADMIN_CLAIM_CODE) &&
    safeEqual(code, env.ADMIN_CLAIM_CODE || "");

  if (!isFirstAdminCode) {
    const codeHash = await hashInviteCode(code);
    const claimed = await env.DB.prepare(
      `UPDATE admin_invites
       SET used_at = CURRENT_TIMESTAMP
       WHERE code_hash = ?1 AND used_at IS NULL AND expires_at > CURRENT_TIMESTAMP`,
    )
      .bind(codeHash)
      .run();
    if (!claimed.meta.changes) {
      await sendMessage(env, message.chat.id, "Kode undangan tidak valid, sudah dipakai, atau sudah kedaluwarsa.", false);
      return;
    }
  }

  await env.DB.prepare(
    "INSERT INTO admins(telegram_user_id, display_name) VALUES (?1, ?2)",
  )
    .bind(String(user.id), displayName(user))
    .run();
  await sendMessage(
    env,
    message.chat.id,
    "✅ Akun ini sekarang menjadi admin layar masjid. Gunakan tombol di bawah untuk mengelola konten.",
  );
}

async function createAdminInvite(env: Env, chatId: number, userId: number) {
  const code = generateInviteCode();
  const codeHash = await hashInviteCode(code);
  await env.DB.prepare(
    "DELETE FROM admin_invites WHERE used_at IS NOT NULL OR expires_at <= CURRENT_TIMESTAMP",
  ).run();
  await env.DB.prepare(
    `INSERT INTO admin_invites(code_hash, created_by, expires_at)
     VALUES (?1, ?2, datetime('now', '+24 hours'))`,
  )
    .bind(codeHash, String(userId))
    .run();
  await sendMessage(
    env,
    chatId,
    `<b>Kode undangan admin</b>\n<code>${code}</code>\n\nKirim kode ini kepada calon admin. Ia cukup mengirim:\n<code>/claim ${code}</code>\n\nKode berlaku 24 jam dan hanya dapat dipakai satu kali.`,
  );
}

async function setSession(env: Env, userId: number, action: string) {
  await env.DB.prepare(
    `INSERT INTO sessions(telegram_user_id, action, created_at)
     VALUES (?1, ?2, CURRENT_TIMESTAMP)
     ON CONFLICT(telegram_user_id) DO UPDATE SET action = excluded.action, created_at = CURRENT_TIMESTAMP`,
  )
    .bind(String(userId), action)
    .run();
}

async function clearSession(env: Env, userId: number) {
  await env.DB.prepare("DELETE FROM sessions WHERE telegram_user_id = ?1")
    .bind(String(userId))
    .run();
}

async function getSession(env: Env, userId: number) {
  const row = await env.DB.prepare(
    "SELECT action FROM sessions WHERE telegram_user_id = ?1",
  )
    .bind(String(userId))
    .first<{ action: string }>();
  return row?.action || null;
}

async function listContent(env: Env, chatId: number) {
  const [slides, ticker, timings, friday] = await Promise.all([
    env.DB.prepare(
      "SELECT id, kind, title, youtube_id FROM slides WHERE active = 1 ORDER BY sort_order, id",
    ).all<{ id: number; kind: string; title: string | null; youtube_id: string | null }>(),
    env.DB.prepare("SELECT value FROM settings WHERE key = 'ticker'").first<{ value: string }>(),
    getTimingSettings(env),
    getFridaySettings(env),
  ]);
  const slideText = slides.results.length
    ? slides.results
        .map((slide) =>
          slide.kind === "poster"
            ? `#${slide.id} • Poster${slide.title ? ` — ${slide.title}` : ""}`
            : `#${slide.id} • YouTube — ${slide.youtube_id}`,
        )
        .join("\n")
    : "Belum ada slide. Tambahkan poster atau video dari menu.";

  await sendMessage(
    env,
    chatId,
    `<b>Konten layar</b>\n${slideText}\n\n<b>Info berjalan</b>\n${ticker?.value || "Tidak ditampilkan"}\n\n<b>Jeda iqomah</b>\n${formatTimingMap(timings.iqamahDelays)}\n\n<b>Durasi mode sholat</b>\n${formatTimingMap(timings.prayerDurations, PRAYER_DURATION_NAMES)}\n\n<b>Mode Jumat</b>\n${formatFridaySettings(friday)}\n\nUntuk menghapus slide, kirim <code>/hapus ID</code>.`,
  );
}

async function downloadTelegramFile(env: Env, fileId: string) {
  const file = await telegram<{ file_path?: string }>(env, "getFile", { file_id: fileId });
  if (!file.file_path) throw new Error("Telegram file path is missing");
  const response = await fetch(
    `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${file.file_path}`,
  );
  if (!response.ok || !response.body) throw new Error("Unable to download Telegram file");
  return { response, path: file.file_path };
}

async function savePoster(env: Env, message: TelegramMessage, userId: number, posterName: string) {
  const photo = message.photo?.at(-1);
  const document = message.document;
  const fileId = photo?.file_id || document?.file_id;
  const mimeType = document?.mime_type || "image/jpeg";
  if (!fileId || !mimeType.startsWith("image/")) {
    await sendMessage(env, message.chat.id, "Kirim posternya sebagai foto atau dokumen gambar ya.");
    return;
  }

  const fileSize = photo?.file_size || document?.file_size || 0;
  if (fileSize > 10 * 1024 * 1024) {
    await sendMessage(env, message.chat.id, "Posternya terlalu besar. Maksimal 10 MB ya.");
    return;
  }

  const downloaded = await downloadTelegramFile(env, fileId);
  const extension = downloaded.path.split(".").pop()?.replace(/[^a-z0-9]/gi, "") || "jpg";
  const key = `posters/${Date.now()}-${userId}.${extension}`;
  await env.MEDIA.put(key, downloaded.response.body, {
    httpMetadata: { contentType: mimeType, cacheControl: "public, max-age=31536000, immutable" },
  });

  const maxOrder = await env.DB.prepare(
    "SELECT COALESCE(MAX(sort_order), 0) AS value FROM slides WHERE active = 1",
  ).first<{ value: number }>();
  await env.DB.prepare(
    `INSERT INTO slides(kind, title, media_key, duration_seconds, sort_order)
     VALUES ('poster', ?1, ?2, 12, ?3)`,
  )
    .bind(posterName, key, Number(maxOrder?.value || 0) + 1)
    .run();
  await clearSession(env, userId);
  await sendMessage(env, message.chat.id, "✅ Poster sudah ditambahkan. Layar TV akan mengambil pembaruan otomatis.");
}

async function saveYouTube(env: Env, message: TelegramMessage, userId: number, text: string) {
  const youtubeId = extractYouTubeId(text);
  if (!youtubeId || !/^[\w-]{11}$/.test(youtubeId)) {
    await sendMessage(env, message.chat.id, "Link YouTube belum terbaca. Coba kirim link dari tombol <b>Bagikan</b> di YouTube.");
    return;
  }

  await env.DB.prepare("UPDATE slides SET active = 0, updated_at = CURRENT_TIMESTAMP WHERE kind = 'youtube'").run();
  const maxOrder = await env.DB.prepare(
    "SELECT COALESCE(MAX(sort_order), 0) AS value FROM slides WHERE active = 1",
  ).first<{ value: number }>();
  await env.DB.prepare(
    `INSERT INTO slides(kind, title, youtube_id, duration_seconds, sort_order)
     VALUES ('youtube', 'Video Masjid', ?1, 60, ?2)`,
  )
    .bind(youtubeId, Number(maxOrder?.value || 0) + 1)
    .run();
  await clearSession(env, userId);
  await sendMessage(env, message.chat.id, "✅ Video YouTube sudah diganti. Layar TV akan memperbaruinya otomatis.");
}

async function saveTicker(env: Env, message: TelegramMessage, userId: number, text: string) {
  const value = text.trim().slice(0, 800);
  if (value.length < 3) {
    await sendMessage(env, message.chat.id, "Teksnya terlalu pendek. Coba kirim ulang ya.");
    return;
  }

  await env.DB.prepare(
    `INSERT INTO settings(key, value, updated_at)
     VALUES ('ticker', ?1, CURRENT_TIMESTAMP)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
  )
    .bind(value)
    .run();
  await clearSession(env, userId);
  await sendMessage(env, message.chat.id, "✅ Info berjalan sudah diperbarui.");
}

async function clearTicker(env: Env, chatId: number, userId: number) {
  await env.DB.prepare(
    `INSERT INTO settings(key, value, updated_at)
     VALUES ('ticker', '', CURRENT_TIMESTAMP)
     ON CONFLICT(key) DO UPDATE SET value = '', updated_at = CURRENT_TIMESTAMP`,
  ).run();
  await clearSession(env, userId);
  await sendMessage(env, chatId, "✅ Info bagian bawah sudah disembunyikan.");
}

async function promptTimingSetting(
  env: Env,
  chatId: number,
  userId: number,
  kind: "iqamah" | "prayer_duration",
) {
  const timings = await getTimingSettings(env);
  const isIqamah = kind === "iqamah";
  const current = isIqamah ? timings.iqamahDelays : timings.prayerDurations;
  const names = isIqamah ? PRAYER_NAMES : PRAYER_DURATION_NAMES;
  await setSession(env, userId, kind);
  await sendMessage(
    env,
    chatId,
    `<b>${isIqamah ? "Jeda iqomah setelah adzan" : "Durasi mode sholat"}</b>\n${formatTimingMap(current, names)}\n\nKirim satu atau beberapa baris yang ingin diubah, contoh:\n<code>${isIqamah ? "Subuh 10\nMaghrib 5" : "Subuh 15\nJumat 40"}</code>`,
  );
}

async function saveTimingSetting(
  env: Env,
  message: TelegramMessage,
  userId: number,
  text: string,
  kind: "iqamah" | "prayer_duration",
) {
  const isIqamah = kind === "iqamah";
  const minimum = isIqamah ? 1 : 5;
  const maximum = isIqamah ? 60 : 90;
  const names = isIqamah ? PRAYER_NAMES : PRAYER_DURATION_NAMES;
  const { updates, invalid } = parseTimingUpdates(text, minimum, maximum, names);
  if (!Object.keys(updates).length || invalid.length) {
    await sendMessage(
      env,
      message.chat.id,
      `Format belum terbaca. Gunakan contoh <code>Subuh 10</code>. Batas ${minimum}–${maximum} menit.`,
    );
    return;
  }

  const timings = await getTimingSettings(env);
  const current = isIqamah ? timings.iqamahDelays : timings.prayerDurations;
  const next = { ...current, ...updates };
  const key = isIqamah ? "iqamah_delays" : "prayer_durations";
  await env.DB.prepare(
    `INSERT INTO settings(key, value, updated_at)
     VALUES (?1, ?2, CURRENT_TIMESTAMP)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
  )
    .bind(key, JSON.stringify(next))
    .run();
  await clearSession(env, userId);
  await sendMessage(
    env,
    message.chat.id,
    `✅ ${isIqamah ? "Jeda iqomah" : "Durasi mode sholat"} sudah diperbarui.\n\n${formatTimingMap(next, names)}`,
  );
}

async function promptFridaySettings(env: Env, chatId: number, userId: number) {
  const friday = await getFridaySettings(env);
  await setSession(env, userId, "friday");
  await sendMessage(
    env,
    chatId,
    `<b>Informasi Jumat</b>\n${formatFridaySettings(friday)}\n\nKirim satu atau beberapa baris yang ingin diubah, contoh:\n<code>Tema: Menjaga Amanah\nKhatib: Ust. Ahmad\nImam: Ust. Hasan</code>`,
  );
}

async function saveFridaySettings(env: Env, message: TelegramMessage, userId: number, text: string) {
  const current = await getFridaySettings(env);
  const updates: Partial<FridaySettings> = {};
  const invalid: string[] = [];
  const fieldNames: Record<string, keyof FridaySettings> = {
    tema: "theme",
    theme: "theme",
    khatib: "khatib",
    imam: "imam",
  };

  for (const line of text.split("\n").map((part) => part.trim()).filter(Boolean)) {
    const match = line.match(/^([A-Za-z]+)\s*[:=]\s*(.+)$/);
    const field = match ? fieldNames[match[1].toLowerCase()] : null;
    const value = match?.[2].trim();
    if (!field || !value) {
      invalid.push(line);
      continue;
    }
    updates[field] = (value === "-" ? "Akan diumumkan" : value).slice(0, field === "theme" ? 160 : 100);
  }

  if (!Object.keys(updates).length || invalid.length) {
    await sendMessage(env, message.chat.id, "Format belum terbaca. Gunakan contoh <code>Tema: Menjaga Amanah</code>.");
    return;
  }

  const next = { ...current, ...updates };
  await env.DB.prepare(
    `INSERT INTO settings(key, value, updated_at)
     VALUES ('friday_settings', ?1, CURRENT_TIMESTAMP)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
  )
    .bind(JSON.stringify(next))
    .run();
  await clearSession(env, userId);
  await sendMessage(env, message.chat.id, `✅ Informasi Jumat sudah diperbarui.\n\n${formatFridaySettings(next)}`);
}

async function deleteSlide(env: Env, message: TelegramMessage, idText: string) {
  const id = Number(idText);
  if (!Number.isInteger(id) || id <= 0) {
    await sendMessage(env, message.chat.id, "Formatnya <code>/hapus ID</code>, contoh <code>/hapus 3</code>.");
    return;
  }

  const slide = await env.DB.prepare(
    "SELECT media_key FROM slides WHERE id = ?1 AND active = 1",
  )
    .bind(id)
    .first<{ media_key: string | null }>();
  if (!slide) {
    await sendMessage(env, message.chat.id, "Slide tersebut tidak ditemukan.");
    return;
  }

  await env.DB.prepare(
    "UPDATE slides SET active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?1",
  )
    .bind(id)
    .run();
  if (slide.media_key) await env.MEDIA.delete(slide.media_key);
  await sendMessage(env, message.chat.id, "✅ Slide sudah dihapus dari layar.");
}

async function promptDeletePoster(env: Env, chatId: number, userId: number) {
  const posters = await env.DB.prepare(
    "SELECT id, title FROM slides WHERE active = 1 AND kind = 'poster' ORDER BY sort_order, id",
  ).all<{ id: number; title: string | null }>();

  if (!posters.results.length) {
    await clearSession(env, userId);
    await sendMessage(env, chatId, "Belum ada poster aktif yang bisa dihapus.");
    return;
  }

  const list = posters.results
    .map((poster) => `<code>${poster.id}</code> • ${escapeHtml(poster.title || "Poster kegiatan masjid")}`)
    .join("\n");
  await setSession(env, userId, "delete_poster");
  await sendMessage(env, chatId, `<b>Pilih poster yang akan dihapus</b>\n${list}\n\nKirim nomor ID posternya, contoh <code>1</code>.`);
}

async function deletePoster(env: Env, message: TelegramMessage, userId: number, idText: string) {
  const id = Number(idText.trim());
  if (!Number.isInteger(id) || id <= 0) {
    await sendMessage(env, message.chat.id, "Kirim nomor ID poster saja, contoh <code>1</code>.");
    return;
  }

  const poster = await env.DB.prepare(
    "SELECT media_key FROM slides WHERE id = ?1 AND active = 1 AND kind = 'poster'",
  )
    .bind(id)
    .first<{ media_key: string | null }>();
  if (!poster) {
    await sendMessage(env, message.chat.id, "Poster dengan ID tersebut tidak ditemukan. Coba pilih lagi dari menu <b>Hapus poster</b>.");
    return;
  }

  await env.DB.prepare(
    "UPDATE slides SET active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?1 AND kind = 'poster'",
  )
    .bind(id)
    .run();
  if (poster.media_key) await env.MEDIA.delete(poster.media_key);
  await clearSession(env, userId);
  await sendMessage(env, message.chat.id, "✅ Poster sudah dihapus. Layar TV akan memperbarui otomatis.");
}

async function handleTelegramUpdate(env: Env, update: TelegramUpdate) {
  const message = update.message;
  const user = message?.from;
  if (!message || !user) return;

  const text = message.text?.trim() || message.caption?.trim() || "";
  if (text === "/id") {
    await sendMessage(env, message.chat.id, `ID Telegram kamu: <code>${user.id}</code>`, false);
    return;
  }

  if (text.startsWith("/claim ")) {
    await claimAdmin(env, message, text.slice(7).trim());
    return;
  }

  if (!(await isAdmin(env, user.id))) {
    await sendMessage(env, message.chat.id, "Bot layar masjid belum aktif untuk akun ini. Minta kode aktivasi kepada pengelola.", false);
    return;
  }

  if (text === "/start" || text === "/menu") {
    await sendMessage(
      env,
      message.chat.id,
      "<b>Pengelola Layar Masjid Al-Hidayah</b>\nPilih yang ingin diperbarui dari tombol di bawah.",
    );
    return;
  }

  if (text === "❌ Batal" || text === "/batal") {
    await clearSession(env, user.id);
    await sendMessage(env, message.chat.id, "Dibatalkan. Silakan pilih menu lain.");
    return;
  }

  if (text === "📋 Lihat konten" || text === "/list") {
    await listContent(env, message.chat.id);
    return;
  }

  if (text === "👤 Undang admin" || text === "/undang") {
    await createAdminInvite(env, message.chat.id, user.id);
    return;
  }

  if (text === "🧹 Sembunyikan info" || text === "/hapusinfo") {
    await clearTicker(env, message.chat.id, user.id);
    return;
  }

  if (text === "⏱ Atur iqomah" || text === "/iqomah") {
    await promptTimingSetting(env, message.chat.id, user.id, "iqamah");
    return;
  }

  if (text === "🕌 Durasi sholat" || text === "/durasisholat") {
    await promptTimingSetting(env, message.chat.id, user.id, "prayer_duration");
    return;
  }

  if (text === "🕋 Mode Jumat" || text === "/jumat") {
    await promptFridaySettings(env, message.chat.id, user.id);
    return;
  }

  if (text === "🗑 Hapus poster" || text === "/hapusposter") {
    await promptDeletePoster(env, message.chat.id, user.id);
    return;
  }

  if (text.startsWith("/hapus ")) {
    await deleteSlide(env, message, text.slice(7).trim());
    return;
  }

  if (text === "🖼 Tambah poster" || text === "/poster") {
    await setSession(env, user.id, "poster_name");
    await sendMessage(env, message.chat.id, "Ketik nama poster untuk memudahkan pengelolaan di Telegram. Nama ini tidak akan ditampilkan di layar TV.");
    return;
  }

  if (text === "▶️ Ganti YouTube" || text === "/youtube") {
    await setSession(env, user.id, "youtube");
    await sendMessage(env, message.chat.id, "Kirim link video YouTube yang ingin ditampilkan.");
    return;
  }

  if (text === "📢 Ubah info TV" || text === "/info") {
    await setSession(env, user.id, "ticker");
    await sendMessage(env, message.chat.id, "Kirim teks info yang akan berjalan di bagian bawah layar.");
    return;
  }

  const session = await getSession(env, user.id);
  if (session === "poster_name") {
    if (!message.text || text.length < 2 || text.length > 80) {
      await sendMessage(env, message.chat.id, "Ketik nama poster sepanjang 2–80 karakter terlebih dahulu, contoh <code>Jadwal Ta'lim Agustus</code>.");
      return;
    }
    await setSession(env, user.id, `poster_upload:${encodeURIComponent(text)}`);
    await sendMessage(env, message.chat.id, `Nama poster: <b>${escapeHtml(text)}</b>\nSekarang kirim gambar posternya.`);
  } else if (session?.startsWith("poster_upload:")) {
    const posterName = decodeURIComponent(session.slice("poster_upload:".length));
    await savePoster(env, message, user.id, posterName);
  } else if (session === "youtube" && text) {
    await saveYouTube(env, message, user.id, text);
  } else if (session === "ticker" && text) {
    await saveTicker(env, message, user.id, text);
  } else if (session === "iqamah" && text) {
    await saveTimingSetting(env, message, user.id, text, "iqamah");
  } else if (session === "prayer_duration" && text) {
    await saveTimingSetting(env, message, user.id, text, "prayer_duration");
  } else if (session === "friday" && text) {
    await saveFridaySettings(env, message, user.id, text);
  } else if (session === "delete_poster" && text) {
    await deletePoster(env, message, user.id, text);
  } else {
    await sendMessage(env, message.chat.id, "Pilih salah satu menu di bawah ya.");
  }
}

async function publicDisplay(env: Env, request: Request) {
  const url = new URL(request.url);
  const [slides, settings] = await Promise.all([
    env.DB.prepare(
      `SELECT id, kind, title, media_key, youtube_id, duration_seconds
       FROM slides WHERE active = 1 ORDER BY sort_order, id`,
    ).all<{
      id: number;
      kind: "poster" | "youtube";
      title: string | null;
      media_key: string | null;
      youtube_id: string | null;
      duration_seconds: number;
    }>(),
    env.DB.prepare(
      "SELECT key, value, updated_at FROM settings WHERE key IN ('ticker', 'iqamah_delays', 'prayer_durations', 'friday_settings')",
    ).all<{
      key: string;
      value: string;
      updated_at: string;
    }>(),
  ]);
  const settingValues = Object.fromEntries(settings.results.map((row) => [row.key, row.value]));
  const updatedAt = settings.results
    .map((row) => row.updated_at)
    .sort()
    .at(-1) || null;

  return json(
    {
      slides: slides.results.map((slide) => ({
        id: slide.id,
        kind: slide.kind,
        title: slide.kind === "youtube" ? slide.title : null,
        imageUrl: slide.media_key ? `${url.origin}/media/${slide.media_key}` : null,
        youtubeId: slide.youtube_id,
        durationSeconds: slide.duration_seconds,
      })),
      ticker: settingValues.ticker || null,
      iqamahDelays: parseTimingSetting(settingValues.iqamah_delays, DEFAULT_IQAMAH_DELAYS),
      prayerDurations: parseTimingSetting(settingValues.prayer_durations, DEFAULT_PRAYER_DURATIONS),
      friday: parseFridaySettings(settingValues.friday_settings),
      updatedAt,
    },
    200,
    { "cache-control": "no-store" },
  );
}

async function setupTelegram(env: Env, request: Request) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_WEBHOOK_SECRET) {
    return json({ ok: false, error: "Telegram secrets are not configured" }, 503);
  }
  const url = new URL(request.url);
  const result = await telegram(env, "setWebhook", {
    url: `${url.origin}/telegram/webhook`,
    secret_token: env.TELEGRAM_WEBHOOK_SECRET,
    allowed_updates: ["message"],
    drop_pending_updates: true,
  });
  return json({ ok: true, webhook: `${url.origin}/telegram/webhook`, result });
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: jsonHeaders });

    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true, telegramConfigured: Boolean(env.TELEGRAM_BOT_TOKEN) });
    }
    if (request.method === "GET" && url.pathname === "/api/display") {
      return publicDisplay(env, request);
    }
    if (request.method === "GET" && url.pathname.startsWith("/media/")) {
      const key = decodeURIComponent(url.pathname.slice("/media/".length));
      const object = await env.MEDIA.get(key);
      if (!object) return new Response("Not found", { status: 404 });
      const headers = new Headers();
      object.writeHttpMetadata(headers);
      headers.set("etag", object.httpEtag);
      headers.set("access-control-allow-origin", "*");
      headers.set("x-content-type-options", "nosniff");
      return new Response(object.body, { headers });
    }
    if (request.method === "POST" && url.pathname === "/telegram/setup") {
      return setupTelegram(env, request);
    }
    if (request.method === "POST" && url.pathname === "/telegram/webhook") {
      const suppliedSecret = request.headers.get("x-telegram-bot-api-secret-token") || "";
      if (!env.TELEGRAM_WEBHOOK_SECRET || !safeEqual(suppliedSecret, env.TELEGRAM_WEBHOOK_SECRET)) {
        return new Response("Unauthorized", { status: 401 });
      }
      const update = (await request.json()) as TelegramUpdate;
      ctx.waitUntil(handleTelegramUpdate(env, update));
      return json({ ok: true });
    }

    return json({
      service: "Jam Masjid Al-Hidayah Bot",
      status: "ready",
      endpoints: ["/health", "/api/display"],
    });
  },
};

export default worker;
