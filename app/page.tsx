"use client";

import { useEffect, useMemo, useState } from "react";

const TIME_ZONE = "Asia/Jakarta";

const prayerSchedule = [
  { name: "Subuh", adhan: "04:38", iqamah: "04:50" },
  { name: "Dzuhur", adhan: "11:58", iqamah: "12:10" },
  { name: "Ashar", adhan: "15:18", iqamah: "15:30" },
  { name: "Maghrib", adhan: "17:52", iqamah: "18:00" },
  { name: "Isya", adhan: "19:04", iqamah: "19:15" },
] as const;

const timeFormatter = new Intl.DateTimeFormat("id-ID", {
  timeZone: TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
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

const clockPartsFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function getTimeParts(date: Date) {
  const parts = Object.fromEntries(
    clockPartsFormatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );

  return {
    hours: parts.hour,
    minutes: parts.minute,
    seconds: parts.second,
  };
}

function getNextIqamah(date: Date) {
  const { hours, minutes, seconds } = getTimeParts(date);
  const currentSeconds = hours * 3600 + minutes * 60 + seconds;

  for (const prayer of prayerSchedule) {
    const [iqamahHour, iqamahMinute] = prayer.iqamah.split(":").map(Number);
    const iqamahSeconds = iqamahHour * 3600 + iqamahMinute * 60;

    if (iqamahSeconds > currentSeconds) {
      return {
        prayer,
        secondsRemaining: iqamahSeconds - currentSeconds,
      };
    }
  }

  const [subuhHour, subuhMinute] = prayerSchedule[0].iqamah
    .split(":")
    .map(Number);

  return {
    prayer: prayerSchedule[0],
    secondsRemaining:
      24 * 3600 - currentSeconds + subuhHour * 3600 + subuhMinute * 60,
  };
}

function formatCountdown(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return [hours, minutes, seconds]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
}

export default function Home() {
  const [now, setNow] = useState<Date | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const updateClock = () => setNow(new Date());
    updateClock();
    const timer = window.setInterval(updateClock, 1000);

    const handleFullscreen = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", handleFullscreen);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("fullscreenchange", handleFullscreen);
    };
  }, []);

  const nextIqamah = useMemo(() => (now ? getNextIqamah(now) : null), [now]);
  const timeParts = now ? timeFormatter.format(now).replaceAll(".", ":").split(":") : ["--", "--", "--"];

  const toggleFullscreen = async () => {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await document.documentElement.requestFullscreen();
    }
  };

  return (
    <main className="display-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />

      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            <span className="crescent">☾</span>
          </div>
          <div>
            <p className="eyebrow">SELAMAT DATANG DI</p>
            <h1>Masjid Al-Hikmah</h1>
          </div>
        </div>

        <div className="topbar-actions">
          <div className="live-status">
            <span className="status-dot" />
            Waktu Indonesia Barat
          </div>
          <button className="fullscreen-button" onClick={toggleFullscreen} type="button">
            <span aria-hidden="true">{isFullscreen ? "↙" : "↗"}</span>
            {isFullscreen ? "Keluar" : "Layar penuh"}
          </button>
        </div>
      </header>

      <section className="hero-grid">
        <div className="clock-panel">
          <div className="clock-label">
            <span /> Waktu sekarang
          </div>
          <div className="clock" aria-label={now ? timeFormatter.format(now) : "Memuat waktu"}>
            <span>{timeParts[0]}</span>
            <i>:</i>
            <span>{timeParts[1]}</span>
            <small>{timeParts[2]}</small>
          </div>
          <div className="date-row">
            <p>{now ? dateFormatter.format(now) : "Memuat tanggal…"}</p>
            <span aria-hidden="true" />
            <p>{now ? hijriFormatter.format(now) : "Memuat tanggal Hijriah…"}</p>
          </div>
        </div>

        <aside className="countdown-panel">
          <div className="ornament" aria-hidden="true">✦</div>
          <p className="countdown-kicker">MENUJU IQOMAH</p>
          <h2>{nextIqamah?.prayer.name ?? "—"}</h2>
          <div className="countdown-time">
            {nextIqamah ? formatCountdown(nextIqamah.secondsRemaining) : "--:--:--"}
          </div>
          <div className="countdown-labels">
            <span>Jam</span>
            <span>Menit</span>
            <span>Detik</span>
          </div>
          <p className="iqamah-note">
            Adzan {nextIqamah?.prayer.adhan ?? "--:--"} <span>•</span> Iqomah {nextIqamah?.prayer.iqamah ?? "--:--"}
          </p>
        </aside>
      </section>

      <section className="schedule-section" aria-labelledby="schedule-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">JADWAL HARI INI</p>
            <h2 id="schedule-title">Waktu Sholat</h2>
          </div>
          <p className="section-reminder">“Luruskan dan rapatkan shaf.”</p>
        </div>

        <div className="prayer-grid">
          {prayerSchedule.map((prayer) => {
            const isNext = nextIqamah?.prayer.name === prayer.name;
            return (
              <article className={`prayer-card${isNext ? " active" : ""}`} key={prayer.name}>
                {isNext && <span className="next-badge">BERIKUTNYA</span>}
                <div className="prayer-card-top">
                  <span className="prayer-icon" aria-hidden="true">{prayer.name === "Subuh" ? "◒" : prayer.name === "Maghrib" ? "◓" : "☼"}</span>
                  <h3>{prayer.name}</h3>
                </div>
                <div className="prayer-times">
                  <div>
                    <span>Adzan</span>
                    <strong>{prayer.adhan}</strong>
                  </div>
                  <div className="time-divider" />
                  <div>
                    <span>Iqomah</span>
                    <strong>{prayer.iqamah}</strong>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <footer className="announcement-bar">
        <div className="announcement-label"><span aria-hidden="true">●</span> INFO MASJID</div>
        <div className="ticker-window">
          <p>Mohon menonaktifkan suara ponsel selama berada di dalam masjid &nbsp; • &nbsp; Jaga kebersihan dan ketenangan rumah Allah &nbsp; • &nbsp; Kajian rutin setiap Sabtu ba’da Maghrib</p>
        </div>
      </footer>
    </main>
  );
}
