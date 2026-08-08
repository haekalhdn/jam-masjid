"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const TIME_ZONE = "Asia/Jakarta";
const SCHEDULE_API = "https://www.muslimkita.id/api/jadwal-sholat/v1/depok/";
const SCHEDULE_CACHE_KEY = "jadwal-sholat-depok";
const CONTENT_API = "https://jam-masjid-bot.alhidayah-sawangan.workers.dev/api/display";
const APP_VERSION = "2026.08.08.11";

type PrayerName = "Subuh" | "Dzuhur" | "Ashar" | "Maghrib" | "Isya";
type TimingMap = Record<PrayerName, number>;
type PrayerDurationMap = TimingMap & { Jumat: number };
type Prayer = { name: PrayerName; adhan: string; iqamah: string };
type DailyTimes = { imsak: string; syuruk: string };
type FridaySettings = { theme: string; khatib: string; imam: string };
type ContentSlide = {
  id: number;
  kind: "poster" | "youtube";
  title: string | null;
  imageUrl: string | null;
  youtubeId: string | null;
  durationSeconds: number;
};
type FridaySlide = FridaySettings & { id: "friday"; kind: "friday"; durationSeconds: number };
type DisplaySlide = ContentSlide | FridaySlide;
type YouTubePlayerInstance = {
  destroy: () => void;
  mute: () => void;
  playVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
};
type YouTubeNamespace = {
  Player: new (
    element: HTMLElement,
    options: {
      videoId: string;
      host?: string;
      playerVars: Record<string, string | number>;
      events: {
        onReady: (event: { target: YouTubePlayerInstance }) => void;
        onStateChange: (event: { data: number; target: YouTubePlayerInstance }) => void;
        onError: () => void;
      };
    },
  ) => YouTubePlayerInstance;
  PlayerState: { ENDED: number };
};

declare global {
  interface Window {
    YT?: YouTubeNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let youtubeApiPromise: Promise<YouTubeNamespace> | null = null;

function loadYouTubeApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (youtubeApiPromise) return youtubeApiPromise;

  youtubeApiPromise = new Promise((resolve) => {
    const previousReady = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previousReady?.();
      resolve(window.YT as YouTubeNamespace);
    };
    if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      script.async = true;
      document.head.append(script);
    }
  });

  return youtubeApiPromise;
}

function YouTubeVideo({
  videoId,
  title,
  active,
  restartOnEnd,
  onEnded,
}: {
  videoId: string;
  title: string;
  active: boolean;
  restartOnEnd: boolean;
  onEnded: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onEndedRef = useRef(onEnded);

  useEffect(() => {
    onEndedRef.current = onEnded;
  }, [onEnded]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !active) return;
    let cancelled = false;
    let player: YouTubePlayerInstance | null = null;
    let errorTimer: number | null = null;

    void loadYouTubeApi().then((YT) => {
      if (cancelled) return;
      const mount = document.createElement("div");
      container.append(mount);
      player = new YT.Player(mount, {
        videoId,
        host: "https://www.youtube-nocookie.com",
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
            if (restartOnEnd) {
              event.target.seekTo(0, true);
              event.target.playVideo();
              return;
            }
            onEndedRef.current();
          },
          onError() {
            errorTimer = window.setTimeout(() => onEndedRef.current(), 3000);
          },
        },
      });
    });

    return () => {
      cancelled = true;
      if (errorTimer !== null) window.clearTimeout(errorTimer);
      try {
        player?.destroy();
      } catch {
        // Pemutar mungkin sudah dilepas oleh browser.
      }
      container.replaceChildren();
    };
  }, [active, restartOnEnd, videoId]);

  return <div className="video-player" ref={containerRef} aria-label={title} />;
}
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
type DisplayPhase =
  | { type: "normal" }
  | { type: "daily"; name: "Imsak" | "Syuruk" }
  | { type: "adhan"; prayer: Prayer }
  | { type: "countdown"; prayer: Prayer; secondsRemaining: number }
  | { type: "shaf"; prayer: Prayer }
  | { type: "prayer"; prayer: Prayer };

const FALLBACK_SCHEDULE: Prayer[] = [
  { name: "Subuh", adhan: "04:46", iqamah: "04:53" },
  { name: "Dzuhur", adhan: "12:03", iqamah: "12:10" },
  { name: "Ashar", adhan: "15:23", iqamah: "15:30" },
  { name: "Maghrib", adhan: "17:58", iqamah: "18:05" },
  { name: "Isya", adhan: "19:09", iqamah: "19:16" },
];
const FALLBACK_DAILY_TIMES: DailyTimes = { imsak: "04:36", syuruk: "05:59" };

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

function normalizeTimingMap<T extends Record<string, number>>(values: Partial<T> | undefined, defaults: T): T {
  return Object.fromEntries(
    Object.keys(defaults).map((name) => {
      const candidate = Number(values?.[name]);
      return [name, Number.isFinite(candidate) ? candidate : defaults[name]];
    }),
  ) as T;
}

function scheduleFromApi(jadwal: Record<string, string>, iqamahDelays: TimingMap): Prayer[] {
  const prayerData: Array<{ name: PrayerName; key: string }> = [
    { name: "Subuh", key: "subuh" },
    { name: "Dzuhur", key: "dzuhur" },
    { name: "Ashar", key: "ashar" },
    { name: "Maghrib", key: "maghrib" },
    { name: "Isya", key: "isya" },
  ];

  return prayerData.map(({ name, key }) => {
    const adhan = normalizeTime(jadwal[key]);
    return { name, adhan, iqamah: addMinutes(adhan, iqamahDelays[name]) };
  });
}

function dailyTimesFromApi(jadwal: Record<string, string>): DailyTimes {
  return {
    imsak: normalizeTime(jadwal.imsak),
    syuruk: normalizeTime(jadwal.terbit),
  };
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

const weekdayFormatter = new Intl.DateTimeFormat("id-ID", {
  timeZone: TIME_ZONE,
  weekday: "long",
});

function isFriday(date: Date) {
  return weekdayFormatter.format(date).toLowerCase() === "jumat";
}

function prayerLabel(prayer: Prayer, date: Date) {
  return prayer.name === "Dzuhur" && isFriday(date) ? "Jumat" : prayer.name;
}

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

function getDisplayPhase(
  date: Date,
  prayerSchedule: Prayer[],
  dailyTimes: DailyTimes,
  prayerDurations: PrayerDurationMap,
): DisplayPhase {
  const { hours, minutes, seconds } = getTimeParts(date);
  const currentSeconds = hours * 3600 + minutes * 60 + seconds;
  const adhanNoticeDuration = 30;
  const shafNoticeDuration = 10;

  const dailyNotices: Array<{ name: "Imsak" | "Syuruk"; time: string }> = [
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
    const prayerModeDuration = prayerDurations[prayerLabel(prayer, date)] * 60;
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

function formatCountdown(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return String(minutes).padStart(2, "0") + ":" + String(seconds).padStart(2, "0");
}

export default function Home() {
  const [now, setNow] = useState<Date | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [prayerSchedule, setPrayerSchedule] = useState<Prayer[]>(FALLBACK_SCHEDULE);
  const [dailyTimes, setDailyTimes] = useState<DailyTimes>(FALLBACK_DAILY_TIMES);
  const [contentSlides, setContentSlides] = useState<ContentSlide[]>([]);
  const [ticker, setTicker] = useState("");
  const [prayerDurations, setPrayerDurations] = useState<PrayerDurationMap>(DEFAULT_PRAYER_DURATIONS);
  const [fridaySettings, setFridaySettings] = useState<FridaySettings>(DEFAULT_FRIDAY_SETTINGS);
  const [activeSlide, setActiveSlide] = useState(0);
  const [availableVersion, setAvailableVersion] = useState<string | null>(null);
  const [isSimulation, setIsSimulation] = useState(false);
  const contentSignature = useRef("");
  const iqamahDelaysRef = useRef<TimingMap>(DEFAULT_IQAMAH_DELAYS);
  const displayPhase: DisplayPhase = now
    ? getDisplayPhase(now, prayerSchedule, dailyTimes, prayerDurations)
    : { type: "normal" };
  const fridayMode = now ? isFriday(now) : false;
  const displaySlides = useMemo<DisplaySlide[]>(
    () => [
      ...(fridayMode
        ? [{ id: "friday" as const, kind: "friday" as const, durationSeconds: 15, ...fridaySettings }]
        : []),
      ...contentSlides,
    ],
    [contentSlides, fridayMode, fridaySettings],
  );

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
    setActiveSlide(0);
  }, [fridayMode]);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (displayPhase.type !== "normal") return;
    if (!displaySlides.length) return;
    if (displaySlides[activeSlide]?.kind === "youtube") return;
    const duration = Math.max(5, displaySlides[activeSlide]?.durationSeconds || 12) * 1000;
    const slideTimer = window.setTimeout(
      () => setActiveSlide((current) => (current + 1) % displaySlides.length),
      duration,
    );
    return () => window.clearTimeout(slideTimer);
  }, [activeSlide, displayPhase.type, displaySlides]);

  useEffect(() => {
    let cancelled = false;

    const loadContent = async () => {
      try {
        const response = await fetch(CONTENT_API, { cache: "no-store" });
        if (!response.ok) return;
        const data = (await response.json()) as {
          slides?: ContentSlide[];
          ticker?: string | null;
          iqamahDelays?: Partial<TimingMap>;
          prayerDurations?: Partial<PrayerDurationMap>;
          friday?: Partial<FridaySettings>;
        };
        if (cancelled) return;
        const nextSignature = JSON.stringify(data);
        if (nextSignature === contentSignature.current) return;
        contentSignature.current = nextSignature;
        const nextIqamahDelays = normalizeTimingMap(data.iqamahDelays, DEFAULT_IQAMAH_DELAYS);
        const nextPrayerDurations = normalizeTimingMap(data.prayerDurations, DEFAULT_PRAYER_DURATIONS);
        iqamahDelaysRef.current = nextIqamahDelays;
        setPrayerDurations(nextPrayerDurations);
        setFridaySettings({
          theme: String(data.friday?.theme || DEFAULT_FRIDAY_SETTINGS.theme),
          khatib: String(data.friday?.khatib || DEFAULT_FRIDAY_SETTINGS.khatib),
          imam: String(data.friday?.imam || DEFAULT_FRIDAY_SETTINGS.imam),
        });
        setPrayerSchedule((current) =>
          current.map((prayer) => ({
            ...prayer,
            iqamah: addMinutes(prayer.adhan, nextIqamahDelays[prayer.name]),
          })),
        );
        setContentSlides(Array.isArray(data.slides) ? data.slides : []);
        setTicker(typeof data.ticker === "string" ? data.ticker.trim() : "");
        setActiveSlide(0);
      } catch {
        // Jam dan jadwal sholat tetap berjalan tanpa konten tambahan.
      }
    };

    void loadContent();
    const contentTimer = window.setInterval(loadContent, 30 * 1000);
    return () => {
      cancelled = true;
      window.clearInterval(contentTimer);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const pageParams = new URLSearchParams(window.location.search);
    const simulationPrayer = pageParams.get("demo") === "maghrib" ? "Maghrib" : null;
    const simulationRun = pageParams.get("run") || "default";
    const simulationStorageKey = "jam-masjid-demo-maghrib-" + simulationRun;

    setIsSimulation(Boolean(simulationPrayer));

    const applySimulation = (schedule: Prayer[]) => {
      if (!simulationPrayer) return schedule;

      let demoAdhan = window.sessionStorage.getItem(simulationStorageKey);
      if (!demoAdhan) {
        const target = new Date(Date.now() + 3 * 60 * 1000);
        target.setSeconds(0, 0);
        if (target.getTime() - Date.now() < 3 * 60 * 1000) {
          target.setMinutes(target.getMinutes() + 1);
        }
        const { hours, minutes } = getTimeParts(target);
        demoAdhan =
          String(hours).padStart(2, "0") + ":" + String(minutes).padStart(2, "0");
        window.sessionStorage.setItem(simulationStorageKey, demoAdhan);
      }

      return schedule.map((prayer) =>
        prayer.name === simulationPrayer
          ? {
              ...prayer,
              adhan: demoAdhan,
              iqamah: addMinutes(demoAdhan, iqamahDelaysRef.current[prayer.name]),
            }
          : prayer,
      );
    };

    setPrayerSchedule((current) => applySimulation(current));

    const loadSchedule = async () => {
      const dateKey = dateKeyFormatter.format(new Date());

      try {
        const cached = window.localStorage.getItem(SCHEDULE_CACHE_KEY);
        if (cached) {
          const parsed = JSON.parse(cached) as {
            date: string;
            schedule: Prayer[];
            dailyTimes?: DailyTimes;
          };
          if (parsed.date === dateKey && !cancelled) {
            setPrayerSchedule(
              applySimulation(
              parsed.schedule.map((prayer) => ({
                ...prayer,
                iqamah: addMinutes(prayer.adhan, iqamahDelaysRef.current[prayer.name]),
              })),
              ),
            );
            if (parsed.dailyTimes) setDailyTimes(parsed.dailyTimes);
          }
        }

        const response = await fetch(`${SCHEDULE_API}?tanggal=${dateKey}`, { cache: "no-store" });
        if (!response.ok) throw new Error("Jadwal Depok tidak tersedia");

        const data = (await response.json()) as { jadwal: Record<string, string> };
        const schedule = scheduleFromApi(data.jadwal, iqamahDelaysRef.current);
        const nextDailyTimes = dailyTimesFromApi(data.jadwal);

        if (!cancelled) {
          setPrayerSchedule(applySimulation(schedule));
          setDailyTimes(nextDailyTimes);
          window.localStorage.setItem(
            SCHEDULE_CACHE_KEY,
            JSON.stringify({ date: dateKey, schedule, dailyTimes: nextDailyTimes }),
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

  useEffect(() => {
    let cancelled = false;

    const checkForUpdates = async () => {
      try {
        const response = await fetch("/version.json?t=" + Date.now(), { cache: "no-store" });
        if (!response.ok) return;
        const data = (await response.json()) as { version?: string };
        if (!cancelled && data.version && data.version !== APP_VERSION) {
          setAvailableVersion(data.version);
        }
      } catch {
        // Pemeriksaan berikutnya akan mencoba lagi saat koneksi tersedia.
      }
    };

    void checkForUpdates();
    const updateTimer = window.setInterval(checkForUpdates, 60 * 1000);

    return () => {
      cancelled = true;
      window.clearInterval(updateTimer);
    };
  }, []);

  useEffect(() => {
    if (!availableVersion || displayPhase.type !== "normal") return;
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("v", availableVersion);
    window.location.replace(nextUrl.toString());
  }, [availableVersion, displayPhase.type]);

  const nextIqamah = useMemo(
    () => (now ? getNextIqamah(now, prayerSchedule) : null),
    [now, prayerSchedule],
  );
  const timeParts = now ? timeFormatter.format(now).replaceAll(".", ":").split(":") : ["--", "--", "--"];
  const shellModeClass = {
    normal: "",
    daily: " daily-notice-mode",
    adhan: " adhan-mode",
    countdown: " iqamah-countdown-mode",
    shaf: " shaf-mode",
    prayer: " prayer-mode",
  }[displayPhase.type];

  const toggleFullscreen = async () => {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await document.documentElement.requestFullscreen();
    }
  };

  return (
    <main className={"display-shell" + shellModeClass}>
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />

      {(displayPhase.type === "daily" ||
        displayPhase.type === "adhan" ||
        displayPhase.type === "countdown" ||
        displayPhase.type === "shaf") && (
        <section className={"transition-screen " + displayPhase.type} aria-live="polite" aria-atomic="true">
          <p className="transition-kicker">
            {displayPhase.type === "daily"
              ? "PENGINGAT WAKTU"
              : displayPhase.type === "adhan"
                ? "WAKTU SHOLAT"
                : "IQOMAH"}
          </p>
          <h2>
            {displayPhase.type === "daily"
              ? "Sudah Waktunya " + displayPhase.name
              : displayPhase.type === "adhan"
              ? "Sudah Masuk Waktu " + prayerLabel(displayPhase.prayer, now || new Date())
              : displayPhase.type === "countdown"
                ? "Iqomah " + prayerLabel(displayPhase.prayer, now || new Date())
                : "Luruskan dan Rapatkan Shaf"}
          </h2>
          {displayPhase.type === "countdown" && (
            <strong className="transition-countdown">
              {formatCountdown(displayPhase.secondsRemaining)}
            </strong>
          )}
          {displayPhase.type === "adhan" && (
            <p className="transition-message">Mari bersiap menunaikan sholat berjamaah.</p>
          )}
        </section>
      )}

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

      <section className={`hero-grid${displaySlides.length ? "" : " content-empty"}`}>
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
          <div className="daily-times" aria-label="Waktu Imsak dan Syuruk">
            <div className="daily-time">
              <span>Imsak</span>
              <strong>{dailyTimes.imsak}</strong>
            </div>
            <i aria-hidden="true" />
            <div className="daily-time">
              <span>Syuruk</span>
              <strong>{dailyTimes.syuruk}</strong>
            </div>
          </div>
        </div>

        <div
          className={`content-carousel${displaySlides.length ? "" : " content-empty"}`}
          aria-label="Informasi kegiatan masjid"
          aria-roledescription="carousel"
          aria-hidden={!displaySlides.length}
        >
          {displaySlides.map((slide, index) => (
            <div
              className={`carousel-slide ${slide.kind === "poster" ? "poster-slide" : slide.kind === "youtube" ? "video-slide" : "friday-slide"}${activeSlide === index ? " active" : ""}`}
              aria-hidden={activeSlide !== index}
              key={slide.id}
            >
              {slide.kind === "friday" ? (
                <>
                  <div className="friday-heading">
                    <p className="eyebrow">SHOLAT JUMAT</p>
                    <h2>{slide.theme}</h2>
                  </div>
                  <div className="friday-details">
                    <div><span>Khatib</span><strong>{slide.khatib}</strong></div>
                    <div><span>Imam</span><strong>{slide.imam}</strong></div>
                  </div>
                </>
              ) : slide.kind === "poster" && slide.imageUrl ? (
                <img src={slide.imageUrl} alt={slide.title || "Poster kegiatan Masjid Al-Hidayah"} />
              ) : (
                slide.youtubeId && (
                  <YouTubeVideo
                    videoId={slide.youtubeId}
                    title={slide.title || "Video Masjid Al-Hidayah"}
                    active={activeSlide === index && displayPhase.type === "normal"}
                    restartOnEnd={displaySlides.length === 1}
                    onEnded={() => setActiveSlide((index + 1) % displaySlides.length)}
                  />
                )
              )}
            </div>
          ))}

          {displaySlides.length > 0 && (
            <div className="carousel-dots" aria-label="Pilih slide">
              {displaySlides.map((slide, index) => (
                <button
                  className={`carousel-dot${activeSlide === index ? " active" : ""}`}
                  key={slide.id}
                  onClick={() => setActiveSlide(index)}
                  type="button"
                  aria-current={activeSlide === index ? "true" : undefined}
                  aria-label={`Tampilkan slide ${index + 1}`}
                />
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="schedule-section" aria-labelledby="schedule-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">JADWAL KOTA DEPOK</p>
            <h2 id="schedule-title">Waktu Sholat</h2>
          </div>
          <p className={"section-reminder" + (isSimulation ? " simulation" : "")}>
            {isSimulation
              ? "MODE SIMULASI • Maghrib dimulai sekitar 3 menit lagi"
              : "Kemenag RI • Iqomah sesuai pengaturan DKM"}
          </p>
        </div>

        <div className="prayer-grid">
          {prayerSchedule.map((prayer) => {
            const isNext = nextIqamah?.prayer.name === prayer.name;
            const displayName = now ? prayerLabel(prayer, now) : prayer.name;
            const isFridayCard = displayName === "Jumat";
            return (
              <article className={`prayer-card${isNext ? " active" : ""}${isFridayCard ? " friday-card" : ""}`} key={prayer.name}>
                {isNext && <span className="next-badge">BERIKUTNYA</span>}
                <div className="prayer-card-top">
                  <span className="prayer-icon" aria-hidden="true">{prayer.name === "Subuh" ? "◒" : prayer.name === "Maghrib" ? "◓" : "☼"}</span>
                  <h3>{displayName}</h3>
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

      <footer className="announcement-bar" hidden={!ticker}>
        <div className="announcement-label"><span aria-hidden="true">●</span> INFO MASJID</div>
        <div className="ticker-window">
          <p>{ticker}</p>
        </div>
      </footer>
    </main>
  );
}
