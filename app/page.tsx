"use client";

import { useEffect, useMemo, useState } from "react";

const TIME_ZONE = "Asia/Jakarta";
const SCHEDULE_API = "https://www.muslimkita.id/api/jadwal-sholat/v1/depok/";
const SCHEDULE_CACHE_KEY = "jadwal-sholat-depok";

type Prayer = { name: string; adhan: string; iqamah: string };

const FALLBACK_SCHEDULE: Prayer[] = [
  { name: "Subuh", adhan: "04:46", iqamah: "04:53" },
  { name: "Dzuhur", adhan: "12:03", iqamah: "12:10" },
  { name: "Ashar", adhan: "15:23", iqamah: "15:30" },
  { name: "Maghrib", adhan: "17:58", iqamah: "18:05" },
  { name: "Isya", adhan: "19:09", iqamah: "19:16" },
];

const dateKeyFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function normalizeTime(value: string) {
  return value.replace(".", ":");
}

function addMinutes(time: string, minutesToAdd: number) {
  const [hours, minutes] = normalizeTime(time).split(":").map(Number);
  const totalMinutes = (hours * 60 + minutes + minutesToAdd) % (24 * 60);
  return `${String(Math.floor(totalMinutes / 60)).padStart(2, "0")}:${String(totalMinutes % 60).padStart(2, "0")}`;
}

function scheduleFromApi(jadwal: Record<string, string>): Prayer[] {
  const prayerData = [
    { name: "Subuh", key: "subuh", delay: 7 },
    { name: "Dzuhur", key: "dzuhur", delay: 7 },
    { name: "Ashar", key: "ashar", delay: 7 },
    { name: "Maghrib", key: "maghrib", delay: 7 },
    { name: "Isya", key: "isya", delay: 7 },
  ];

  return prayerData.map(({ name, key, delay }) => {
    const adhan = normalizeTime(jadwal[key]);
    return { name, adhan, iqamah: addMinutes(adhan, delay) };
  });
}

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

function getNextIqamah(date: Date, prayerSchedule: Prayer[]) {
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

export default function Home() {
  const [now, setNow] = useState<Date | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [prayerSchedule, setPrayerSchedule] = useState<Prayer[]>(FALLBACK_SCHEDULE);
  const [activeSlide, setActiveSlide] = useState(0);

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

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const slideTimer = window.setInterval(
      () => setActiveSlide((current) => (current + 1) % 2),
      12000,
    );
    return () => window.clearInterval(slideTimer);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadSchedule = async () => {
      const dateKey = dateKeyFormatter.format(new Date());

      try {
        const cached = window.localStorage.getItem(SCHEDULE_CACHE_KEY);
        if (cached) {
          const parsed = JSON.parse(cached) as { date: string; schedule: Prayer[] };
          if (parsed.date === dateKey && !cancelled) {
            setPrayerSchedule(
              parsed.schedule.map((prayer) => ({
                ...prayer,
                iqamah: addMinutes(prayer.adhan, 7),
              })),
            );
          }
        }

        const response = await fetch(`${SCHEDULE_API}?tanggal=${dateKey}`, { cache: "no-store" });
        if (!response.ok) throw new Error("Jadwal Depok tidak tersedia");

        const data = (await response.json()) as { jadwal: Record<string, string> };
        const schedule = scheduleFromApi(data.jadwal);

        if (!cancelled) {
          setPrayerSchedule(schedule);
          window.localStorage.setItem(
            SCHEDULE_CACHE_KEY,
            JSON.stringify({ date: dateKey, schedule }),
          );
        }
      } catch {
        // Jadwal terakhir atau fallback tetap digunakan saat internet terputus.
      }
    };

    void loadSchedule();
    const refreshTimer = window.setInterval(loadSchedule, 60 * 60 * 1000);

    return () => {
      cancelled = true;
      window.clearInterval(refreshTimer);
    };
  }, []);

  const nextIqamah = useMemo(
    () => (now ? getNextIqamah(now, prayerSchedule) : null),
    [now, prayerSchedule],
  );
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
          <div>
            <p className="eyebrow">SELAMAT DATANG DI</p>
            <h1>Masjid Jami’ Al-Hidayah</h1>
            <p className="brand-location">Bedahan • Sawangan • Depok</p>
          </div>
        </div>

        <div className="center-logo">
          <img
            src="/logo-masjid-al-hidayah.png"
            alt="Logo Masjid Jami Al-Hidayah"
          />
        </div>

        <div className="topbar-actions">
          <div className="live-status">
            <span className="status-dot" />
            Waktu Indonesia Barat
          </div>
          <button className="fullscreen-button" onClick={toggleFullscreen} type="button">
            <span className="fullscreen-icon" aria-hidden="true">{isFullscreen ? "↙" : "↗"}</span>
            <span className="fullscreen-text">{isFullscreen ? "Keluar" : "Layar penuh"}</span>
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

        <div className="content-carousel" aria-label="Informasi kegiatan masjid" aria-roledescription="carousel">
          <div className={`carousel-slide poster-slide${activeSlide === 0 ? " active" : ""}`} aria-hidden={activeSlide !== 0}>
            <img
              src="/jadwal-talim-agustus-2026.png"
              alt="Jadwal Ta’lim Masjid Al-Hidayah bulan Agustus 2026"
            />
          </div>

          <div className={`carousel-slide agenda-slide${activeSlide === 1 ? " active" : ""}`} aria-hidden={activeSlide !== 1}>
            <div>
              <p className="eyebrow">AGENDA TA’LIM AGUSTUS</p>
              <h2>Majelis ilmu untuk jamaah dan keluarga</h2>
            </div>
            <div className="agenda-list">
              <div className="agenda-item"><strong>09 Agu</strong><span>Ta’lim Subuh Ahad</span><small>Dr. KH. Kamaludin, MA.</small></div>
              <div className="agenda-item"><strong>15 Agu</strong><span>Tahsinul Qur’an</span><small>Ust. Iip Ikhwanurrahman</small></div>
              <div className="agenda-item"><strong>17 Agu</strong><span>Ta’lim malam ba’da Magrib</span><small>Ust. Rahmat Hidayat</small></div>
            </div>
          </div>

          <div className="carousel-dots" aria-label="Pilih slide">
            {[0, 1].map((slide) => (
              <button
                className={`carousel-dot${activeSlide === slide ? " active" : ""}`}
                key={slide}
                onClick={() => setActiveSlide(slide)}
                type="button"
                aria-current={activeSlide === slide ? "true" : undefined}
                aria-label={`Tampilkan slide ${slide + 1}`}
              />
            ))}
          </div>
        </div>
      </section>

      <section className="schedule-section" aria-labelledby="schedule-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">JADWAL KOTA DEPOK</p>
            <h2 id="schedule-title">Waktu Sholat</h2>
          </div>
          <p className="section-reminder">Kemenag RI • Iqomah 7 menit setelah adzan</p>
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
