const TIME_ZONE = "Asia/Jakarta";
const SCHEDULE_API = "https://www.muslimkita.id/api/jadwal-sholat/v1/depok/";
const SCHEDULE_CACHE_KEY = "jadwal-sholat-depok";
const APP_VERSION = "2026.08.08.6";
const pageParams = new URLSearchParams(window.location.search);
const simulationPrayer = pageParams.get("demo") === "maghrib" ? "Maghrib" : null;
const simulationRun = pageParams.get("run") || "default";
const simulationStorageKey = "jam-masjid-demo-maghrib-" + simulationRun;

let prayerSchedule = [
  { name: "Subuh", adhan: "04:46", iqamah: "04:53" },
  { name: "Dzuhur", adhan: "12:03", iqamah: "12:10" },
  { name: "Ashar", adhan: "15:23", iqamah: "15:30" },
  { name: "Maghrib", adhan: "17:58", iqamah: "18:05" },
  { name: "Isya", adhan: "19:09", iqamah: "19:16" },
];
let dailyTimes = { imsak: "04:36", syuruk: "05:59" };
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

function scheduleFromApi(jadwal) {
  return [
    { name: "Subuh", key: "subuh", delay: 7 },
    { name: "Dzuhur", key: "dzuhur", delay: 7 },
    { name: "Ashar", key: "ashar", delay: 7 },
    { name: "Maghrib", key: "maghrib", delay: 7 },
    { name: "Isya", key: "isya", delay: 7 },
  ].map(({ name, key, delay }) => {
    const adhan = normalizeTime(jadwal[key]);
    return { name, adhan, iqamah: addMinutes(adhan, delay) };
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

const hijriFormatter = new Intl.DateTimeFormat("id-ID-u-ca-islamic", {
  timeZone: TIME_ZONE,
  day: "numeric",
  month: "long",
  year: "numeric",
});

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
      ? { ...prayer, adhan: demoAdhan, iqamah: addMinutes(demoAdhan, 7) }
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
  const prayerModeDuration = 10 * 60;

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
  const nextUrl = new URL(window.location.href);
  nextUrl.searchParams.set("v", version);
  window.location.replace(nextUrl.toString());
}

async function checkForUpdates() {
  try {
    const response = await fetch("./version.json?t=" + Date.now(), { cache: "no-store" });
    if (!response.ok) return;
    const data = await response.json();
    if (!data.version || data.version === APP_VERSION) return;

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
  document.querySelectorAll(".prayer-card").forEach((card) => {
    const prayer = prayerSchedule.find((item) => item.name === card.dataset.prayer);
    if (!prayer) return;
    const values = card.querySelectorAll(".prayer-times strong");
    values[0].textContent = prayer.adhan;
    values[1].textContent = prayer.iqamah;
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
            iqamah: addMinutes(prayer.adhan, 7),
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
}

function updateDisplay() {
  const now = new Date();
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
    updateVideoPlayer(displayMode === "normal" && activeSlide === 2);
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
    transitionTitle.textContent = isDaily
      ? "Sudah Waktunya " + phase.name
      : isAdhan
        ? "Sudah Masuk Waktu " + phase.prayer.name
        : isCountdown
          ? "Iqomah " + phase.prayer.name
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
  document.querySelector("#hijri-date").textContent = hijriFormatter.format(now);
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

const carouselSlides = [...document.querySelectorAll(".carousel-slide")];
const carouselDots = [...document.querySelectorAll(".carousel-dot")];
const videoPlayer = document.querySelector(".video-player");
const slideDurations = [12000, 12000, 60000];
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
let activeSlide = 0;
let slideTimer;

function updateVideoPlayer(isActive) {
  if (!videoPlayer) return;
  const existingPlayer = videoPlayer.querySelector("iframe");

  if (!isActive) {
    existingPlayer?.remove();
    return;
  }

  if (existingPlayer) return;
  const videoId = videoPlayer.dataset.youtubeId;
  const iframe = document.createElement("iframe");
  iframe.src =
    "https://www.youtube-nocookie.com/embed/" +
    videoId +
    "?autoplay=1&mute=1&loop=1&playlist=" +
    videoId +
    "&playsinline=1&rel=0";
  iframe.title = "Pengurus DKM Alhidayah 2026–2029";
  iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
  iframe.allowFullscreen = true;
  videoPlayer.append(iframe);
}

function scheduleNextSlide() {
  window.clearTimeout(slideTimer);
  if (reducedMotion || displayMode !== "normal") return;
  slideTimer = window.setTimeout(
    () => showSlide((activeSlide + 1) % carouselSlides.length),
    slideDurations[activeSlide] ?? 12000,
  );
}

function showSlide(index) {
  activeSlide = index;
  updateVideoPlayer(displayMode === "normal" && activeSlide === 2);
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
  scheduleNextSlide();
}

carouselDots.forEach((dot) => {
  dot.addEventListener("click", () => showSlide(Number(dot.dataset.slide)));
});

scheduleNextSlide();

prayerSchedule = applySimulation(prayerSchedule);
updatePrayerCards();
updateDailyTimes();
updateDisplay();
void loadDepokSchedule();
void checkForUpdates();
window.setInterval(updateDisplay, 1000);
window.setInterval(loadDepokSchedule, 60 * 60 * 1000);
window.setInterval(checkForUpdates, 60 * 1000);
