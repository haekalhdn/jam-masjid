const TIME_ZONE = "Asia/Jakarta";

const prayerSchedule = [
  { name: "Subuh", adhan: "04:38", iqamah: "04:50" },
  { name: "Dzuhur", adhan: "11:58", iqamah: "12:10" },
  { name: "Ashar", adhan: "15:18", iqamah: "15:30" },
  { name: "Maghrib", adhan: "17:52", iqamah: "18:00" },
  { name: "Isya", adhan: "19:04", iqamah: "19:15" },
];

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

updateDisplay();
window.setInterval(updateDisplay, 1000);
