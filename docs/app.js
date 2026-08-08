const TIME_ZONE = "Asia/Jakarta";
const SCHEDULE_API = "https://www.muslimkita.id/api/jadwal-sholat/v1/depok/";
const SCHEDULE_CACHE_KEY = "jadwal-sholat-depok";

let prayerSchedule = [
  { name: "Subuh", adhan: "04:46", iqamah: "04:56" },
  { name: "Dzuhur", adhan: "12:03", iqamah: "12:13" },
  { name: "Ashar", adhan: "15:23", iqamah: "15:33" },
  { name: "Maghrib", adhan: "17:58", iqamah: "18:05" },
  { name: "Isya", adhan: "19:09", iqamah: "19:19" },
];

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
    { name: "Subuh", key: "subuh", delay: 10 },
    { name: "Dzuhur", key: "dzuhur", delay: 10 },
    { name: "Ashar", key: "ashar", delay: 10 },
    { name: "Maghrib", key: "maghrib", delay: 7 },
    { name: "Isya", key: "isya", delay: 10 },
  ].map(({ name, key, delay }) => {
    const adhan = normalizeTime(jadwal[key]);
    return { name, adhan, iqamah: addMinutes(adhan, delay) };
  });
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

function formatCountdown(totalSeconds) {
  return [
    Math.floor(totalSeconds / 3600),
    Math.floor((totalSeconds % 3600) / 60),
    totalSeconds % 60,
  ]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
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

async function loadDepokSchedule() {
  const dateKey = dateKeyFormatter.format(new Date());

  try {
    const cached = window.localStorage.getItem(SCHEDULE_CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (parsed.date === dateKey) {
        prayerSchedule = parsed.schedule;
        updatePrayerCards();
        updateDisplay();
      }
    }

    const response = await fetch(`${SCHEDULE_API}?tanggal=${dateKey}`, { cache: "no-store" });
    if (!response.ok) throw new Error("Jadwal Depok tidak tersedia");
    const data = await response.json();

    prayerSchedule = scheduleFromApi(data.jadwal);
    window.localStorage.setItem(
      SCHEDULE_CACHE_KEY,
      JSON.stringify({ date: dateKey, schedule: prayerSchedule }),
    );
    updatePrayerCards();
    updateDisplay();
  } catch {
    // Jadwal cache atau fallback tetap ditampilkan jika internet terputus.
  }
}

function updateDisplay() {
  const now = new Date();
  const { hour, minute, second } = getTimeParts(now);
  const next = getNextIqamah(now);

  document.querySelector("#clock-hour").textContent = String(hour).padStart(2, "0");
  document.querySelector("#clock-minute").textContent = String(minute).padStart(2, "0");
  document.querySelector("#clock-second").textContent = String(second).padStart(2, "0");
  document.querySelector("#clock").setAttribute("aria-label", clockFormatter.format(now));
  document.querySelector("#current-date").textContent = dateFormatter.format(now);
  document.querySelector("#hijri-date").textContent = hijriFormatter.format(now);
  document.querySelector("#next-prayer").textContent = next.prayer.name;
  document.querySelector("#countdown").textContent = formatCountdown(next.secondsRemaining);
  document.querySelector("#next-adhan").textContent = next.prayer.adhan;
  document.querySelector("#next-iqamah").textContent = next.prayer.iqamah;

  document.querySelectorAll(".prayer-card").forEach((card) => {
    card.classList.toggle("active", card.dataset.prayer === next.prayer.name);
  });
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

updatePrayerCards();
updateDisplay();
void loadDepokSchedule();
window.setInterval(updateDisplay, 1000);
window.setInterval(loadDepokSchedule, 60 * 60 * 1000);
