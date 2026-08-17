const TIME_ZONE = "Asia/Jakarta";
const SCHEDULE_API = "https://www.muslimkita.id/api/jadwal-sholat/v1/depok/";
const SCHEDULE_CACHE_KEY = "jadwal-sholat-depok";
const APP_VERSION = "2026.08.17.8";
const UPDATE_ATTEMPT_KEY = "jam-masjid-update-attempt";
const CONTENT_API = "https://jam-masjid-bot.alhidayah-sawangan.workers.dev/api/display";
const CONTENT_REFRESH_MS = 30 * 1000;
const pageParams = new URLSearchParams(window.location.search);
const simulationPrayer = pageParams.get("demo") === "maghrib" ? "Maghrib" : null;
const simulationRun = pageParams.get("run") || "default";
const simulationStorageKey = "jam-masjid-demo-maghrib-" + simulationRun;
const DEFAULT_IQAMAH_DELAYS = { Subuh: 7, Dzuhur: 7, Ashar: 7, Maghrib: 7, Isya: 7 };
const DEFAULT_PRAYER_DURATIONS = { Subuh: 10, Dzuhur: 10, Ashar: 10, Maghrib: 10, Isya: 10, Jumat: 40 };
const DEFAULT_FRIDAY_SETTINGS = { theme: "Akan diumumkan", khatib: "Akan diumumkan", imam: "Akan diumumkan" };

let prayerSchedule = [
  { name: "Subuh", adhan: "04:46", iqamah: "04:53" },
  { name: "Dzuhur", adhan: "12:03", iqamah: "12:10" },
  { name: "Ashar", adhan: "15:23", iqamah: "15:30" },
  { name: "Maghrib", adhan: "17:58", iqamah: "18:05" },
  { name: "Isya", adhan: "19:09", iqamah: "19:16" },
];
let dailyTimes = { imsak: "04:36", syuruk: "05:59" };
let iqamahDelays = { ...DEFAULT_IQAMAH_DELAYS };
let prayerDurations = { ...DEFAULT_PRAYER_DURATIONS };
let fridaySettings = { ...DEFAULT_FRIDAY_SETTINGS };
let displayMode = "normal";
let pendingVersion = null;

const dateKeyFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function normalizeTime(value) {
  return value.replace(".", ":");
}

function addMinutes(time, minutesToAdd) {
  const [hours, minutes] = normalizeTime(time).split(":").map(Number);
  const totalMinutes = (hours * 60 + minutes + minutesToAdd) % 1440;
  return `${String(Math.floor(totalMinutes / 60)).padStart(2, "0")}:${String(totalMinutes % 60).padStart(2, "0")}`;
}

function normalizeTimingMap(values, defaults) {
  return Object.fromEntries(
    Object.keys(defaults).map((name) => {
      const candidate = Number(values?.[name]);
      return [name, Number.isFinite(candidate) ? candidate : defaults[name]];
    }),
  );
}

function scheduleFromApi(jadwal) {
  return [
    { name: "Subuh", key: "subuh" },
    { name: "Dzuhur", key: "dzuhur" },
    { name: "Ashar", key: "ashar" },
    { name: "Maghrib", key: "maghrib" },
    { name: "Isya", key: "isya" },
  ].map(({ name, key }) => {
    const adhan = normalizeTime(jadwal[key]);
    return { name, adhan, iqamah: addMinutes(adhan, iqamahDelays[name] ?? 7) };
  });
}

function dailyTimesFromApi(jadwal) {
  return {
    imsak: normalizeTime(jadwal.imsak),
    syuruk: normalizeTime(jadwal.terbit),
  };
}

const clockFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

const dateFormatter = new Intl.DateTimeFormat("id-ID", {
  timeZone: TIME_ZONE,
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

const hijriFormatter = new Intl.DateTimeFormat("id-ID-u-ca-islamic-umalqura", {
  timeZone: TIME_ZONE,
  day: "numeric",
  month: "long",
  year: "numeric",
});
const KEMENAG_HIJRI_STARTS_2026 = [
  { start: "2026-06-16", month: "Muharam", year: 1448 },
  { start: "2026-07-15", month: "Safar", year: 1448 },
  { start: "2026-08-14", month: "Rabiulawal", year: 1448 },
  { start: "2026-09-13", month: "Rabiulakhir", year: 1448 },
  { start: "2026-10-12", month: "Jumadilawal", year: 1448 },
  { start: "2026-11-11", month: "Jumadilakhir", year: 1448 },
  { start: "2026-12-10", month: "Rajab", year: 1448 },
];

function formatHijriDate(date) {
  const dateKey = dateKeyFormatter.format(date);
  if (dateKey >= KEMENAG_HIJRI_STARTS_2026[0].start && dateKey <= "2026-12-31") {
    const month = [...KEMENAG_HIJRI_STARTS_2026].reverse().find((item) => item.start <= dateKey);
    if (month) {
      const day = Math.round((Date.parse(`${dateKey}T00:00:00Z`) - Date.parse(`${month.start}T00:00:00Z`)) / 86400000) + 1;
      return `${day} ${month.month} ${month.year} H`;
    }
  }
  return hijriFormatter.format(date);
}

const weekdayFormatter = new Intl.DateTimeFormat("id-ID", {
  timeZone: TIME_ZONE,
  weekday: "long",
});

function isFriday(date) {
  return weekdayFormatter.format(date).toLowerCase() === "jumat";
}

function prayerLabel(prayer, date) {
  return prayer.name === "Dzuhur" && isFriday(date) ? "Jumat" : prayer.name;
}

function getTimeParts(date) {
  return Object.fromEntries(
    clockFormatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
}

function applySimulation(schedule) {
  if (!simulationPrayer) return schedule;

  let demoAdhan = window.sessionStorage.getItem(simulationStorageKey);
  if (!demoAdhan) {
    const target = new Date(Date.now() + 3 * 60 * 1000);
    target.setSeconds(0, 0);
    if (target.getTime() - Date.now() < 3 * 60 * 1000) {
      target.setMinutes(target.getMinutes() + 1);
    }
    const { hour, minute } = getTimeParts(target);
    demoAdhan = String(hour).padStart(2, "0") + ":" + String(minute).padStart(2, "0");
    window.sessionStorage.setItem(simulationStorageKey, demoAdhan);
  }

  return schedule.map((prayer) =>
    prayer.name === simulationPrayer
      ? { ...prayer, adhan: demoAdhan, iqamah: addMinutes(demoAdhan, iqamahDelays[prayer.name] ?? 7) }
      : prayer,
  );
}

function getNextIqamah(date) {
  const { hour, minute, second } = getTimeParts(date);
  const currentSeconds = hour * 3600 + minute * 60 + second;

  for (const prayer of prayerSchedule) {
    const [iqamahHour, iqamahMinute] = prayer.iqamah.split(":").map(Number);
    const iqamahSeconds = iqamahHour * 3600 + iqamahMinute * 60;
    if (iqamahSeconds > currentSeconds) {
      return { prayer, secondsRemaining: iqamahSeconds - currentSeconds };
    }
  }

  const [subuhHour, subuhMinute] = prayerSchedule[0].iqamah.split(":").map(Number);
  return {
    prayer: prayerSchedule[0],
    secondsRemaining: 86400 - currentSeconds + subuhHour * 3600 + subuhMinute * 60,
  };
}

function getDisplayPhase(date) {
  const { hour, minute, second } = getTimeParts(date);
  const currentSeconds = hour * 3600 + minute * 60 + second;
  const adhanNoticeDuration = 30;
  const shafNoticeDuration = 10;

  const dailyNotices = [
    { name: "Imsak", time: dailyTimes.imsak },
    { name: "Syuruk", time: dailyTimes.syuruk },
  ];

  for (const notice of dailyNotices) {
    const [noticeHour, noticeMinute] = notice.time.split(":").map(Number);
    const noticeSeconds = noticeHour * 3600 + noticeMinute * 60;
    if (currentSeconds >= noticeSeconds && currentSeconds < noticeSeconds + adhanNoticeDuration) {
      return { type: "daily", name: notice.name };
    }
  }

  for (const prayer of prayerSchedule) {
    const name = prayerLabel(prayer, date);
    const prayerModeDuration = (prayerDurations[name] ?? 10) * 60;
    const [adhanHour, adhanMinute] = prayer.adhan.split(":").map(Number);
    const [iqamahHour, iqamahMinute] = prayer.iqamah.split(":").map(Number);
    const adhanSeconds = adhanHour * 3600 + adhanMinute * 60;
    const iqamahSeconds = iqamahHour * 3600 + iqamahMinute * 60;

    if (currentSeconds >= adhanSeconds && currentSeconds < adhanSeconds + adhanNoticeDuration) {
      return { type: "adhan", prayer };
    }

    if (currentSeconds >= adhanSeconds + adhanNoticeDuration && currentSeconds < iqamahSeconds) {
      return { type: "countdown", prayer, secondsRemaining: iqamahSeconds - currentSeconds };
    }

    if (currentSeconds >= iqamahSeconds && currentSeconds < iqamahSeconds + shafNoticeDuration) {
      return { type: "shaf", prayer };
    }

    if (
      currentSeconds >= iqamahSeconds + shafNoticeDuration &&
      currentSeconds < iqamahSeconds + prayerModeDuration
    ) {
      return { type: "prayer", prayer };
    }
  }

  return { type: "normal" };
}

function formatCountdown(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return String(minutes).padStart(2, "0") + ":" + String(seconds).padStart(2, "0");
}

function applyUpdate(version) {
  try {
    if (window.sessionStorage.getItem(UPDATE_ATTEMPT_KEY) === version) return;
    window.sessionStorage.setItem(UPDATE_ATTEMPT_KEY, version);
  } catch {
    // Lanjutkan pembaruan jika penyimpanan browser tidak tersedia.
  }
  const nextUrl = new URL(window.location.href);
  nextUrl.searchParams.set("v", version);
  window.location.replace(nextUrl.toString());
}

async function checkForUpdates() {
  try {
    const response = await fetch("./version.json?t=" + Date.now(), { cache: "no-store" });
    if (!response.ok) return;
    const data = await response.json();
    if (!data.version) return;
    if (data.version === APP_VERSION) {
      try {
        if (window.sessionStorage.getItem(UPDATE_ATTEMPT_KEY) === APP_VERSION) {
          window.sessionStorage.removeItem(UPDATE_ATTEMPT_KEY);
        }
      } catch {
        // Tidak perlu membersihkan jika penyimpanan browser tidak tersedia.
      }
      return;
    }
    try {
      if (window.sessionStorage.getItem(UPDATE_ATTEMPT_KEY) === data.version) return;
    } catch {
      // Tetap lanjutkan pemeriksaan bila penyimpanan browser tidak tersedia.
    }

    if (displayMode === "normal") {
      applyUpdate(data.version);
    } else {
      pendingVersion = data.version;
    }
  } catch {
    // Pemeriksaan berikutnya akan mencoba lagi saat koneksi tersedia.
  }
}

function updatePrayerCards() {
  const now = new Date();
  document.querySelectorAll(".prayer-card").forEach((card) => {
    const prayer = prayerSchedule.find((item) => item.name === card.dataset.prayer);
    if (!prayer) return;
    const values = card.querySelectorAll(".prayer-times strong");
    values[0].textContent = prayer.adhan;
    values[1].textContent = prayer.iqamah;
    card.querySelector("h3").textContent = prayerLabel(prayer, now);
    card.classList.toggle("friday-card", prayer.name === "Dzuhur" && isFriday(now));
  });
}

function updateDailyTimes() {
  document.querySelector("#imsak-time").textContent = dailyTimes.imsak;
  document.querySelector("#syuruk-time").textContent = dailyTimes.syuruk;
}

async function loadDepokSchedule() {
  const dateKey = dateKeyFormatter.format(new Date());

  try {
    const cached = window.localStorage.getItem(SCHEDULE_CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (parsed.date === dateKey) {
        prayerSchedule = applySimulation(
          parsed.schedule.map((prayer) => ({
            ...prayer,
            iqamah: addMinutes(prayer.adhan, iqamahDelays[prayer.name] ?? 7),
          })),
        );
        if (parsed.dailyTimes) dailyTimes = parsed.dailyTimes;
        updatePrayerCards();
        updateDailyTimes();
        updateDisplay();
      }
    }

    const response = await fetch(`${SCHEDULE_API}?tanggal=${dateKey}`, { cache: "no-store" });
    if (!response.ok) throw new Error("Jadwal Depok tidak tersedia");
    const data = await response.json();

    const schedule = scheduleFromApi(data.jadwal);
    prayerSchedule = applySimulation(schedule);
    dailyTimes = dailyTimesFromApi(data.jadwal);
    window.localStorage.setItem(
      SCHEDULE_CACHE_KEY,
      JSON.stringify({ date: dateKey, schedule, dailyTimes }),
    );
    updatePrayerCards();
    updateDailyTimes();
    updateDisplay();
  } catch {
    // Jadwal cache atau fallback tetap ditampilkan jika internet terputus.
  }
}

const displayShell = document.querySelector(".display-shell");
const transitionScreen = document.querySelector(".transition-screen");
const transitionKicker = document.querySelector("#transition-kicker");
const transitionTitle = document.querySelector("#transition-title");
const transitionCountdown = document.querySelector("#transition-countdown");
const transitionMessage = document.querySelector("#transition-message");

if (simulationPrayer) {
  const reminder = document.querySelector(".section-reminder");
  reminder.textContent = "MODE SIMULASI • Maghrib dimulai sekitar 3 menit lagi";
  reminder.classList.add("simulation");
  reminder.hidden = false;
}

function updateDisplay() {
  const now = new Date();
  updatePrayerCards();
  const { hour, minute, second } = getTimeParts(now);
  const next = getNextIqamah(now);
  const phase = getDisplayPhase(now);

  if (phase.type !== displayMode) {
    displayMode = phase.type;
    displayShell.classList.remove(
      "daily-notice-mode",
      "adhan-mode",
      "iqamah-countdown-mode",
      "shaf-mode",
      "prayer-mode",
    );
    if (displayMode === "daily") displayShell.classList.add("daily-notice-mode");
    if (displayMode === "adhan") displayShell.classList.add("adhan-mode");
    if (displayMode === "countdown") displayShell.classList.add("iqamah-countdown-mode");
    if (displayMode === "shaf") displayShell.classList.add("shaf-mode");
    if (displayMode === "prayer") displayShell.classList.add("prayer-mode");
    updateActiveVideoPlayer();
    scheduleNextSlide();
  }

  const showTransition =
    phase.type === "daily" ||
    phase.type === "adhan" ||
    phase.type === "countdown" ||
    phase.type === "shaf";
  transitionScreen.setAttribute("aria-hidden", String(!showTransition));

  if (showTransition) {
    const isAdhan = phase.type === "adhan";
    const isCountdown = phase.type === "countdown";
    const isDaily = phase.type === "daily";
    transitionKicker.textContent = isDaily
      ? "PENGINGAT WAKTU"
      : isAdhan
        ? "WAKTU SHOLAT"
        : "IQOMAH";
    const activePrayerName = phase.prayer ? prayerLabel(phase.prayer, now) : "";
    transitionTitle.textContent = isDaily
      ? "Sudah Waktunya " + phase.name
      : isAdhan
        ? "Sudah Masuk Waktu " + activePrayerName
        : isCountdown
          ? "Iqomah " + activePrayerName
          : "Luruskan dan Rapatkan Shaf";
    transitionCountdown.hidden = !isCountdown;
    if (isCountdown) transitionCountdown.textContent = formatCountdown(phase.secondsRemaining);
    transitionMessage.hidden = !isAdhan;
    if (isAdhan) transitionMessage.textContent = "Mari bersiap menunaikan sholat berjamaah.";
  }

  document.querySelector("#clock-hour").textContent = String(hour).padStart(2, "0");
  document.querySelector("#clock-minute").textContent = String(minute).padStart(2, "0");
  document.querySelector("#clock-second").textContent = String(second).padStart(2, "0");
  document.querySelector("#clock").setAttribute("aria-label", clockFormatter.format(now));
  document.querySelector("#current-date").textContent = dateFormatter.format(now);
  document.querySelector("#hijri-date").textContent = formatHijriDate(now);
  document.querySelectorAll(".prayer-card").forEach((card) => {
    card.classList.toggle("active", card.dataset.prayer === next.prayer.name);
  });

  if (displayMode === "normal" && pendingVersion) {
    applyUpdate(pendingVersion);
  }
}

const fullscreenButton = document.querySelector("#fullscreen-button");
fullscreenButton.addEventListener("click", async () => {
  if (document.fullscreenElement) {
    await document.exitFullscreen();
  } else {
    await document.documentElement.requestFullscreen();
  }
});

document.addEventListener("fullscreenchange", () => {
  const active = Boolean(document.fullscreenElement);
  fullscreenButton.querySelector(".fullscreen-icon").textContent = active ? "↙" : "↗";
  fullscreenButton.querySelector(".fullscreen-text").textContent = active ? "Keluar" : "Layar penuh";
});

const carousel = document.querySelector(".content-carousel");
const heroGrid = document.querySelector(".hero-grid");
const announcementBar = document.querySelector(".announcement-bar");
let carouselSlides = [...document.querySelectorAll(".carousel-slide")];
let carouselDots = [...document.querySelectorAll(".carousel-dot")];
let slideDurations = [];
let contentSignature = "";
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
let activeSlide = 0;
let slideTimer;
let youtubeApiPromise;
const youtubePlayers = new Map();

function loadYouTubeApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (youtubeApiPromise) return youtubeApiPromise;

  youtubeApiPromise = new Promise((resolve) => {
    const previousReady = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previousReady?.();
      resolve(window.YT);
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    document.head.append(script);
  });
  return youtubeApiPromise;
}

function destroyYouTubePlayer(container) {
  const player = youtubePlayers.get(container);
  if (player) {
    try {
      player.destroy();
    } catch {
      // Pemutar mungkin sudah dilepas oleh browser.
    }
    youtubePlayers.delete(container);
  }
  container.replaceChildren();
}

function updateActiveVideoPlayer() {
  document.querySelectorAll(".video-player").forEach((videoPlayer) => {
    const slide = videoPlayer.closest(".carousel-slide");
    const shouldPlay = displayMode === "normal" && carouselSlides[activeSlide] === slide;

    if (!shouldPlay) {
      destroyYouTubePlayer(videoPlayer);
      return;
    }

    if (youtubePlayers.has(videoPlayer) || videoPlayer.dataset.loading === "true") return;
    const videoId = videoPlayer.dataset.youtubeId;
    if (!videoId) return;
    videoPlayer.dataset.loading = "true";

    void loadYouTubeApi().then((YT) => {
      delete videoPlayer.dataset.loading;
      const currentSlide = videoPlayer.closest(".carousel-slide");
      if (displayMode !== "normal" || carouselSlides[activeSlide] !== currentSlide) return;

      const mount = document.createElement("div");
      videoPlayer.append(mount);
      const player = new YT.Player(mount, {
        videoId,
        playerVars: {
          autoplay: 1,
          controls: 1,
          mute: 1,
          playsinline: 1,
          rel: 0,
          origin: window.location.origin,
        },
        events: {
          onReady(event) {
            event.target.mute();
            event.target.playVideo();
          },
          onStateChange(event) {
            if (event.data !== YT.PlayerState.ENDED) return;
            if (carouselSlides[activeSlide] !== currentSlide) return;
            if (carouselSlides.length === 1) {
              event.target.seekTo(0, true);
              event.target.playVideo();
              return;
            }
            showSlide((activeSlide + 1) % carouselSlides.length);
          },
          onError() {
            window.setTimeout(() => {
              if (carouselSlides[activeSlide] === currentSlide) {
                showSlide((activeSlide + 1) % carouselSlides.length);
              }
            }, 3000);
          },
        },
      });
      youtubePlayers.set(videoPlayer, player);
    });
  });
}

function scheduleNextSlide() {
  window.clearTimeout(slideTimer);
  if (reducedMotion || displayMode !== "normal" || !carouselSlides.length) return;
  if (carouselSlides[activeSlide]?.classList.contains("video-slide")) return;
  if (carouselSlides[activeSlide]?.querySelector(".donor-track")) return;
  slideTimer = window.setTimeout(
    () => showSlide((activeSlide + 1) % carouselSlides.length),
    slideDurations[activeSlide] ?? 12000,
  );
}

function restartDonorTicker(slide) {
  const track = slide?.querySelector(".donor-track");
  if (!track || reducedMotion) return;
  track.style.animationName = "none";
  void track.offsetWidth;
  track.style.removeProperty("animation-name");
}

function animateFinanceNumbers(slide) {
  if (!slide?.classList.contains("finance-slide")) return;
  const values = [...slide.querySelectorAll("[data-finance-amount]")];
  if (reducedMotion) {
    values.forEach((value) => {
      value.textContent = formatRupiah(value.dataset.financeAmount);
    });
    return;
  }

  const animationId = String(performance.now());
  slide.dataset.financeAnimation = animationId;
  const startedAt = performance.now();
  const duration = 950;
  const animate = (time) => {
    if (slide.dataset.financeAnimation !== animationId) return;
    const progress = Math.min(1, (time - startedAt) / duration);
    const eased = 1 - Math.pow(1 - progress, 3);
    values.forEach((value) => {
      value.textContent = formatRupiah(Math.round(Number(value.dataset.financeAmount || 0) * eased));
    });
    if (progress < 1) window.requestAnimationFrame(animate);
  };
  values.forEach((value) => {
    value.textContent = formatRupiah(0);
  });
  window.requestAnimationFrame(animate);
}

function showSlide(index) {
  if (!carouselSlides.length) return;
  activeSlide = index;
  updateActiveVideoPlayer();
  carouselSlides.forEach((slide, slideIndex) => {
    const active = slideIndex === activeSlide;
    slide.classList.toggle("active", active);
    slide.setAttribute("aria-hidden", String(!active));
  });
  carouselDots.forEach((dot, dotIndex) => {
    const active = dotIndex === activeSlide;
    dot.classList.toggle("active", active);
    if (active) dot.setAttribute("aria-current", "true");
    else dot.removeAttribute("aria-current");
  });
  restartDonorTicker(carouselSlides[activeSlide]);
  animateFinanceNumbers(carouselSlides[activeSlide]);
  scheduleNextSlide();
}

function bindCarouselDots() {
  carouselDots.forEach((dot) => {
    dot.addEventListener("click", () => showSlide(Number(dot.dataset.slide)));
  });
}

function createPosterSlide(slide) {
  const element = document.createElement("div");
  element.className = "carousel-slide poster-slide";
  element.setAttribute("aria-hidden", "true");
  element.dataset.durationMs = String(Math.max(5, Number(slide.durationSeconds) || 12) * 1000);
  const image = document.createElement("img");
  image.src = slide.imageUrl;
  image.alt = slide.title || "Poster kegiatan Masjid Al-Hidayah";
  element.append(image);
  return element;
}

function createVideoSlide(slide) {
  const element = document.createElement("div");
  element.className = "carousel-slide video-slide";
  element.setAttribute("aria-hidden", "true");
  element.dataset.durationMs = String(Math.max(10, Number(slide.durationSeconds) || 60) * 1000);
  const player = document.createElement("div");
  player.className = "video-player";
  player.dataset.youtubeId = slide.youtubeId;
  player.dataset.title = slide.title || "Video Masjid Al-Hidayah";
  element.append(player);
  return element;
}

function createFridaySlide(settings) {
  const element = document.createElement("div");
  element.className = "carousel-slide friday-slide";
  element.setAttribute("aria-hidden", "true");
  element.dataset.durationMs = "15000";

  const heading = document.createElement("div");
  heading.className = "friday-heading";
  const eyebrow = document.createElement("p");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = "SHOLAT JUMAT";
  const title = document.createElement("h2");
  title.textContent = settings.theme;
  heading.append(eyebrow, title);

  const details = document.createElement("div");
  details.className = "friday-details";
  [["Khatib", settings.khatib], ["Imam", settings.imam]].forEach(([label, value]) => {
    const item = document.createElement("div");
    const caption = document.createElement("span");
    caption.textContent = label;
    const content = document.createElement("strong");
    content.textContent = value;
    item.append(caption, content);
    details.append(item);
  });

  element.append(heading, details);
  return element;
}

function formatRupiah(amount) {
  return `Rp${new Intl.NumberFormat("id-ID").format(Number(amount) || 0)}`;
}

function financeUsagePercent(income, expense) {
  if (Number(income) <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((Number(expense) / Number(income)) * 100)));
}

function donorCycleDurationSeconds(names) {
  return Math.max(70, names.length * 2.5);
}

function createFinanceAmount(amount) {
  const value = document.createElement("strong");
  value.dataset.financeAmount = String(Number(amount) || 0);
  value.textContent = formatRupiah(amount);
  return value;
}

function createFinanceSlide(finance, donors) {
  const element = document.createElement("div");
  element.className = "carousel-slide finance-slide";
  element.setAttribute("aria-hidden", "true");
  const donorCycleSeconds = Array.isArray(donors?.names) && donors.names.length
    ? donorCycleDurationSeconds(donors.names)
    : 0;
  element.dataset.durationMs = String((donorCycleSeconds || 12) * 1000);

  const ornament = document.createElement("span");
  ornament.className = "finance-ornament";
  ornament.setAttribute("aria-hidden", "true");
  ornament.textContent = "✦";

  const heading = document.createElement("div");
  heading.className = "finance-heading";
  const eyebrow = document.createElement("p");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = "TRANSPARANSI KEUANGAN MASJID";
  const title = document.createElement("h2");
  title.textContent = `Kas DKM • ${finance.period}`;
  heading.append(eyebrow, title);

  const balance = document.createElement("div");
  balance.className = "finance-balance";
  const balanceValue = document.createElement("div");
  balanceValue.className = "finance-balance-value";
  const balanceCaption = document.createElement("span");
  balanceCaption.textContent = "Saldo kas saat ini";
  balanceValue.append(balanceCaption, createFinanceAmount(finance.balance));

  const usagePercent = financeUsagePercent(finance.income, finance.expense);
  const usage = document.createElement("div");
  usage.className = "finance-usage";
  const usageCopy = document.createElement("div");
  const usageLabel = document.createElement("span");
  usageLabel.textContent = "Pengeluaran periode ini";
  const usageValue = document.createElement("b");
  usageValue.textContent = `${usagePercent}% dari pemasukan`;
  usageCopy.append(usageLabel, usageValue);
  const usageTrack = document.createElement("div");
  usageTrack.className = "finance-usage-track";
  usageTrack.setAttribute("aria-hidden", "true");
  const usageBar = document.createElement("i");
  usageBar.style.width = `${usagePercent}%`;
  usageTrack.append(usageBar);
  usage.append(usageCopy, usageTrack);
  balance.append(balanceValue, usage);

  let donorRibbon = null;
  if (Array.isArray(donors?.names) && donors.names.length) {
    donorRibbon = document.createElement("div");
    donorRibbon.className = "donor-ribbon";
    const donorLabel = document.createElement("span");
    donorLabel.textContent = "JAZAKUMULLAHU KHAIRAN";
    const marquee = document.createElement("div");
    marquee.className = "donor-marquee";
    const track = document.createElement("div");
    track.className = "donor-track";
    track.style.animationDuration = `${donorCycleSeconds}s`;
    const donorText = `Donatur dan jamaah ${donors.period || finance.period} • ${donors.names.join(" • ")}`;
    const firstCopy = document.createElement("p");
    firstCopy.textContent = donorText;
    const secondCopy = document.createElement("p");
    secondCopy.textContent = donorText;
    secondCopy.setAttribute("aria-hidden", "true");
    track.append(firstCopy, secondCopy);
    track.addEventListener("animationiteration", () => {
      if (displayMode !== "normal" || carouselSlides[activeSlide] !== element) return;
      showSlide((activeSlide + 1) % carouselSlides.length);
    });
    marquee.append(track);
    donorRibbon.append(donorLabel, marquee);
  }

  const metrics = document.createElement("div");
  metrics.className = "finance-metrics";
  [
    ["Pemasukan", finance.income, ""],
    ["Pengeluaran", finance.expense, "expense"],
  ].forEach(([label, amount, className]) => {
    const item = document.createElement("div");
    item.className = `finance-metric${className ? ` ${className}` : ""}`;
    const caption = document.createElement("span");
    caption.textContent = label;
    const value = createFinanceAmount(amount);
    item.append(caption, value);
    metrics.append(item);
  });

  element.append(ornament, heading, balance);
  if (donorRibbon) element.append(donorRibbon);
  element.append(metrics);
  return element;
}

function rebuildCarousel(data) {
  const contentSlides = Array.isArray(data.slides) ? data.slides : [];
  const remotePosters = contentSlides.filter((slide) => slide.kind === "poster" && slide.imageUrl);
  const remoteVideos = contentSlides.filter((slide) => slide.kind === "youtube" && slide.youtubeId);
  const nextSlides = [
    ...(isFriday(new Date()) ? [createFridaySlide(fridaySettings)] : []),
    ...(data.finance ? [createFinanceSlide(data.finance, data.donors)] : []),
    ...remotePosters.map(createPosterSlide),
    ...remoteVideos.map(createVideoSlide),
  ];

  carousel.querySelectorAll(".carousel-slide, .carousel-dots").forEach((element) => element.remove());
  const isEmpty = nextSlides.length === 0;
  carousel.classList.toggle("content-empty", isEmpty);
  carousel.setAttribute("aria-hidden", String(isEmpty));
  heroGrid.classList.toggle("content-empty", isEmpty);
  if (isEmpty) {
    carouselSlides = [];
    carouselDots = [];
    slideDurations = [];
    activeSlide = 0;
    window.clearTimeout(slideTimer);
    updateActiveVideoPlayer();
    return;
  }

  nextSlides.forEach((slide) => carousel.append(slide));

  const dots = document.createElement("div");
  dots.className = "carousel-dots";
  dots.setAttribute("aria-label", "Pilih slide");
  nextSlides.forEach((slide, index) => {
    const dot = document.createElement("button");
    dot.className = "carousel-dot";
    dot.type = "button";
    dot.dataset.slide = String(index);
    dot.setAttribute("aria-label", `Tampilkan slide ${index + 1}`);
    dots.append(dot);
  });
  carousel.append(dots);

  carouselSlides = [...carousel.querySelectorAll(".carousel-slide")];
  carouselDots = [...carousel.querySelectorAll(".carousel-dot")];
  slideDurations = carouselSlides.map((slide) =>
    Number(slide.dataset.durationMs) || (slide.classList.contains("video-slide") ? 60000 : 12000),
  );
  activeSlide = 0;
  bindCarouselDots();
  showSlide(0);
}

async function loadRemoteContent() {
  try {
    const response = await fetch(CONTENT_API, { cache: "no-store" });
    if (!response.ok) return;
    const data = await response.json();
    const nextSignature = JSON.stringify(data) + ":" + isFriday(new Date());
    if (nextSignature === contentSignature) return;
    contentSignature = nextSignature;
    iqamahDelays = normalizeTimingMap(data.iqamahDelays, DEFAULT_IQAMAH_DELAYS);
    prayerDurations = normalizeTimingMap(data.prayerDurations, DEFAULT_PRAYER_DURATIONS);
    fridaySettings = {
      theme: String(data.friday?.theme || DEFAULT_FRIDAY_SETTINGS.theme),
      khatib: String(data.friday?.khatib || DEFAULT_FRIDAY_SETTINGS.khatib),
      imam: String(data.friday?.imam || DEFAULT_FRIDAY_SETTINGS.imam),
    };
    prayerSchedule = prayerSchedule.map((prayer) => ({
      ...prayer,
      iqamah: addMinutes(prayer.adhan, iqamahDelays[prayer.name] ?? 7),
    }));
    updatePrayerCards();
    rebuildCarousel(data);
    const ticker = typeof data.ticker === "string" ? data.ticker.trim() : "";
    announcementBar.hidden = !ticker;
    document.querySelector(".ticker-window p").textContent = ticker;
  } catch {
    // Tampilan utama tetap berjalan saat layanan pembaruan sedang tidak tersedia.
  }
}

bindCarouselDots();

scheduleNextSlide();

prayerSchedule = applySimulation(prayerSchedule);
updatePrayerCards();
updateDailyTimes();
updateDisplay();
void loadDepokSchedule();
void checkForUpdates();
void loadRemoteContent();
window.setInterval(updateDisplay, 1000);
window.setInterval(loadDepokSchedule, 60 * 60 * 1000);
window.setInterval(checkForUpdates, 60 * 1000);
window.setInterval(loadRemoteContent, CONTENT_REFRESH_MS);
