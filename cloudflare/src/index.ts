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

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "content-type",
};

const menuKeyboard = {
  keyboard: [
    [{ text: "🖼 Tambah poster" }, { text: "▶️ Ganti YouTube" }],
    [{ text: "📢 Ubah info TV" }, { text: "🧹 Sembunyikan info" }],
    [{ text: "📋 Lihat konten" }, { text: "❌ Batal" }],
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
  if (!user || !env.ADMIN_CLAIM_CODE || !safeEqual(code, env.ADMIN_CLAIM_CODE)) {
    await sendMessage(env, message.chat.id, "Kode aktivasi tidak sesuai.", false);
    return;
  }

  const count = await env.DB.prepare("SELECT COUNT(*) AS total FROM admins").first<{ total: number }>();
  if (Number(count?.total || 0) > 0) {
    await sendMessage(env, message.chat.id, "Admin utama sudah diaktifkan.", false);
    return;
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
  const slides = await env.DB.prepare(
    "SELECT id, kind, title, youtube_id FROM slides WHERE active = 1 ORDER BY sort_order, id",
  ).all<{ id: number; kind: string; title: string | null; youtube_id: string | null }>();
  const ticker = await env.DB.prepare("SELECT value FROM settings WHERE key = 'ticker'").first<{ value: string }>();
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
    `<b>Konten layar</b>\n${slideText}\n\n<b>Info berjalan</b>\n${ticker?.value || "Tidak ditampilkan"}\n\nUntuk menghapus slide, kirim <code>/hapus ID</code>.`,
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

async function savePoster(env: Env, message: TelegramMessage, userId: number) {
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
    .bind(message.caption?.trim() || "Poster kegiatan masjid", key, Number(maxOrder?.value || 0) + 1)
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

  if (text === "🧹 Sembunyikan info" || text === "/hapusinfo") {
    await clearTicker(env, message.chat.id, user.id);
    return;
  }

  if (text.startsWith("/hapus ")) {
    await deleteSlide(env, message, text.slice(7).trim());
    return;
  }

  if (text === "🖼 Tambah poster" || text === "/poster") {
    await setSession(env, user.id, "poster");
    await sendMessage(env, message.chat.id, "Silakan kirim gambar poster. Caption foto akan dipakai sebagai judul.");
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
  if (session === "poster") {
    await savePoster(env, message, user.id);
  } else if (session === "youtube" && text) {
    await saveYouTube(env, message, user.id, text);
  } else if (session === "ticker" && text) {
    await saveTicker(env, message, user.id, text);
  } else {
    await sendMessage(env, message.chat.id, "Pilih salah satu menu di bawah ya.");
  }
}

async function publicDisplay(env: Env, request: Request) {
  const url = new URL(request.url);
  const [slides, ticker] = await Promise.all([
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
    env.DB.prepare("SELECT value, updated_at FROM settings WHERE key = 'ticker'").first<{
      value: string;
      updated_at: string;
    }>(),
  ]);

  return json(
    {
      slides: slides.results.map((slide) => ({
        id: slide.id,
        kind: slide.kind,
        title: slide.title,
        imageUrl: slide.media_key ? `${url.origin}/media/${slide.media_key}` : null,
        youtubeId: slide.youtube_id,
        durationSeconds: slide.duration_seconds,
      })),
      ticker: ticker?.value || null,
      updatedAt: ticker?.updated_at || null,
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
