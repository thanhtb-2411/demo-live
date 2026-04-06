"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import styles from "./CameraPlayer.module.css";

interface CameraPlayerProps {
  cameraId: string;
  cameraName: string;
  streamUrl: string; // HLS m3u8 URL
  dvrWindowSeconds: number; // Max DVR window (server-side)
  onClose: () => void;
}

type Mode = "live" | "dvr";
type LiveStatus = "connecting" | "playing" | "error";

function fmtTime(d: Date) {
  return d.toLocaleTimeString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Ho_Chi_Minh",
  });
}

function fmtTimeWithSec(d: Date) {
  return d.toLocaleTimeString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "Asia/Ho_Chi_Minh",
  });
}

function fmtDateTime(d: Date) {
  return d.toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "Asia/Ho_Chi_Minh",
  });
}

function relativeLabel(seconds: number): string {
  if (seconds < 5) return "Vừa xong";
  if (seconds < 60) return `${Math.floor(seconds)}s trước`;
  const min = Math.floor(seconds / 60);
  if (min < 60) return `${min} phút trước`;
  const hr = Math.floor(min / 60);
  const remainMin = min % 60;
  if (remainMin === 0) return `${hr} giờ trước`;
  return `${hr}h ${remainMin}ph trước`;
}

export default function CameraPlayer({
  cameraName,
  streamUrl,
  dvrWindowSeconds,
  onClose,
}: CameraPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const modeRef = useRef<Mode>("live");

  const [mode, setMode] = useState<Mode>("live");
  const setModeSync = (m: Mode) => {
    modeRef.current = m;
    setMode(m);
  };

  const [liveStatus, setLiveStatus] = useState<LiveStatus>("connecting");
  const [errorMsg, setErrorMsg] = useState("");
  const [nowTime, setNowTime] = useState(() => new Date());
  const [isDragging, setIsDragging] = useState(false);
  const [dragPercent, setDragPercent] = useState<number | null>(null);
  const [hoverPercent, setHoverPercent] = useState<number | null>(null);
  const [isHoveringTrack, setIsHoveringTrack] = useState(false);
  const [dvrOffsetFromLive, setDvrOffsetFromLive] = useState(0);
  // Seekable duration in seconds (from HLS seekable range)
  const [seekableDuration, setSeekableDuration] = useState(0);

  // Refresh clock every second so timeline keeps ticking
  useEffect(() => {
    const id = setInterval(() => setNowTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // ─── HLS setup ───────────────────────────────────────────
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    setLiveStatus("connecting");
    setErrorMsg("");

    if (Hls.isSupported()) {
      const hls = new Hls({
        // Stay ~3 segments behind live edge
        liveSyncDurationCount: 3,
        liveMaxLatencyDurationCount: 8,
        // Allow client to buffer up to DVR window
        maxBufferLength: 60,
        maxMaxBufferLength: dvrWindowSeconds,
        enableWorker: true,
        // Send Basic Auth with every HLS request
        xhrSetup(xhr) {
          xhr.setRequestHeader(
            "Authorization",
            `Basic ${btoa("viewer:viewer123")}`,
          );
        },
      });
      hlsRef.current = hls;

      hls.loadSource(streamUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(() => {});
        setLiveStatus("playing");
      });

      hls.on(Hls.Events.ERROR, (_, data) => {
        if (!data.fatal) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          // Try to recover transient network errors
          hls.startLoad();
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          hls.recoverMediaError();
        } else {
          setLiveStatus("error");
          setErrorMsg(data.details ?? "HLS lỗi nghiêm trọng");
        }
      });
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      // Safari native HLS
      video.src = streamUrl;
      video.play().catch(() => {});
      video.addEventListener("loadedmetadata", () => setLiveStatus("playing"), {
        once: true,
      });
    } else {
      setLiveStatus("error");
      setErrorMsg("Trình duyệt không hỗ trợ HLS");
    }

    return () => {
      hlsRef.current?.destroy();
      hlsRef.current = null;
      // Safari: clear src directly
      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = "";
      }
    };
  }, [streamUrl, dvrWindowSeconds]);

  // ─── Track current time → DVR offset + mode ──────────────
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onTimeUpdate = () => {
      if (video.seekable.length === 0) return;
      const liveEdge = video.seekable.end(0);
      const start = video.seekable.start(0);
      const offset = Math.max(0, liveEdge - video.currentTime);
      const duration = Math.max(0, liveEdge - start);

      setDvrOffsetFromLive(offset);
      setSeekableDuration(duration);

      if (offset <= 5 && modeRef.current !== "live") setModeSync("live");
      else if (offset > 5 && modeRef.current !== "dvr") setModeSync("dvr");
    };

    video.addEventListener("timeupdate", onTimeUpdate);
    return () => video.removeEventListener("timeupdate", onTimeUpdate);
  }, []);

  // ─── Go back to live edge ─────────────────────────────────
  const goLive = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.seekable.length > 0) {
      video.currentTime = video.seekable.end(0);
    }
  }, []);

  // ─── Timeline calculations ────────────────────────────────
  const timelineMs = Math.max(
    1000,
    Math.min(seekableDuration * 1000, dvrWindowSeconds * 1000),
  );
  const timelineSec = timelineMs / 1000;
  const nowMs = nowTime.getTime();
  const streamStartMs = nowMs - timelineMs;
  const canSeek = seekableDuration > 10;

  const percentToOffset = useCallback(
    (pct: number): number => (1 - pct / 100) * timelineSec,
    [timelineSec],
  );

  const offsetToPercent = useCallback(
    (offsetSec: number) => {
      if (timelineSec <= 0) return 100;
      return Math.max(0, Math.min(100, 100 * (1 - offsetSec / timelineSec)));
    },
    [timelineSec],
  );

  const percentToTime = useCallback(
    (pct: number): Date => new Date(streamStartMs + (pct / 100) * timelineMs),
    [streamStartMs, timelineMs],
  );

  const clientXToPercent = useCallback((clientX: number) => {
    const el = timelineRef.current;
    if (!el) return 100;
    const rect = el.getBoundingClientRect();
    return Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
  }, []);

  const seekToPercent = useCallback(
    (pct: number) => {
      const video = videoRef.current;
      if (!video || video.seekable.length === 0) return;
      const offsetFromLive = percentToOffset(pct);
      if (offsetFromLive <= 3) {
        // Near live edge → snap to live
        video.currentTime = video.seekable.end(0);
      } else {
        const target = video.seekable.end(0) - offsetFromLive;
        video.currentTime = Math.max(video.seekable.start(0), target);
      }
    },
    [percentToOffset],
  );

  // ─── Pointer events ──────────────────────────────────────
  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      timelineRef.current?.setPointerCapture(e.pointerId);
      setIsDragging(true);
      setDragPercent(clientXToPercent(e.clientX));
      e.preventDefault();
    },
    [clientXToPercent],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (isDragging) setDragPercent(clientXToPercent(e.clientX));
    },
    [isDragging, clientXToPercent],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!isDragging) return;
      setIsDragging(false);
      const pct = clientXToPercent(e.clientX);
      setDragPercent(null);
      seekToPercent(pct);
    },
    [isDragging, clientXToPercent, seekToPercent],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isDragging) setHoverPercent(clientXToPercent(e.clientX));
    },
    [isDragging, clientXToPercent],
  );

  const handleMouseEnter = useCallback(() => setIsHoveringTrack(true), []);
  const handleMouseLeave = useCallback(() => {
    setIsHoveringTrack(false);
    setHoverPercent(null);
  }, []);

  // ─── Playhead position ───────────────────────────────────
  const playheadPct =
    dragPercent !== null
      ? dragPercent
      : mode === "live"
        ? 100
        : offsetToPercent(dvrOffsetFromLive);

  // ─── Time labels on timeline ─────────────────────────────
  const getTimeLabels = (): { label: string; pct: number }[] => {
    if (timelineSec <= 5) return [];
    const labels: { label: string; pct: number }[] = [];

    let intervalSec: number;
    if (timelineSec <= 60) intervalSec = 10;
    else if (timelineSec <= 300) intervalSec = 30;
    else if (timelineSec <= 600) intervalSec = 60;
    else if (timelineSec <= 1800) intervalSec = 300;
    else intervalSec = 600;

    for (
      let offset = intervalSec;
      offset < timelineSec;
      offset += intervalSec
    ) {
      const pct = 100 * (1 - offset / timelineSec);
      if (pct > 5 && pct < 92) {
        const t = new Date(nowMs - offset * 1000);
        labels.push({ label: fmtTime(t), pct });
      }
    }
    return labels;
  };

  const timeLabels = getTimeLabels();
  const timelineStartTime = new Date(streamStartMs);

  return (
    <div className={styles.container} id="camera-player">
      {/* ── Header ─────────────────────────────────────────── */}
      <div className={styles.header}>
        <div className={styles.info}>
          <div className={styles.cameraInfo}>
            <span className={styles.cameraIcon}>📹</span>
            <span className={styles.name}>{cameraName}</span>
          </div>
          <div
            className={`${styles.statusChip} ${mode === "live" ? styles.statusChipLive : styles.statusChipDvr}`}
          >
            {mode === "live" ? (
              <>
                <span className={`${styles.statusDot} ${styles[liveStatus]}`} />
                <span className={styles.statusText}>
                  {liveStatus === "connecting"
                    ? "Đang kết nối..."
                    : liveStatus === "playing"
                      ? "LIVE"
                      : "Lỗi"}
                </span>
              </>
            ) : (
              <>
                <span className={styles.dvrDot} />
                <span className={styles.statusText}>
                  {relativeLabel(dvrOffsetFromLive)}
                </span>
              </>
            )}
          </div>
        </div>
        <div className={styles.headerActions}>
          {mode === "dvr" && (
            <button
              className={styles.goLiveBtn}
              onClick={goLive}
              title="Về xem trực tiếp"
            >
              <span className={styles.goLiveDot} />
              Về LIVE
            </button>
          )}
          <button className={styles.closeBtn} onClick={onClose} title="Đóng">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path
                d="M1 1L13 13M1 13L13 1"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* ── Error ──────────────────────────────────────────── */}
      {liveStatus === "error" && (
        <div className={styles.errorBar} role="alert">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 10.5a.75.75 0 110-1.5.75.75 0 010 1.5zM8.75 4.75v4a.75.75 0 01-1.5 0v-4a.75.75 0 011.5 0z" />
          </svg>
          <span>{errorMsg}</span>
        </div>
      )}

      {/* ── Video Area ─────────────────────────────────────── */}
      <div className={styles.videoWrapper}>
        {/* Loading overlay – shown while HLS is connecting */}
        {liveStatus === "connecting" && (
          <div className={styles.overlay}>
            <div className={styles.spinner} />
            <p>Đang thiết lập luồng HLS...</p>
          </div>
        )}

        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className={styles.video}
        />

        {/* DVR time badge */}
        {mode === "dvr" && dvrOffsetFromLive > 0 && (
          <div className={styles.dvrTimeBadge}>
            <span className={styles.dvrTimeBadgeIcon}>⏪</span>
            {fmtDateTime(new Date(Date.now() - dvrOffsetFromLive * 1000))}
          </div>
        )}
      </div>

      {/* ── YouTube-style Timeline ─────────────────────────── */}
      <div
        className={`${styles.timelineContainer} ${isDragging ? styles.timelineDragging : ""}`}
      >
        {/* Hover tooltip */}
        {(hoverPercent !== null || dragPercent !== null) && canSeek && (
          <div
            className={styles.timeTooltip}
            style={{
              left: `${Math.min(94, Math.max(6, dragPercent ?? hoverPercent ?? 0))}%`,
            }}
          >
            <div className={styles.tooltipContent}>
              {(() => {
                const pct = dragPercent ?? hoverPercent ?? 0;
                if (pct >= 98) return "LIVE";
                return fmtTimeWithSec(percentToTime(pct));
              })()}
            </div>
            {(() => {
              const pct = dragPercent ?? hoverPercent ?? 0;
              if (pct >= 98) return null;
              const offset = percentToOffset(pct);
              return (
                <div className={styles.tooltipDate}>
                  {relativeLabel(offset)}
                </div>
              );
            })()}
          </div>
        )}

        {/* Track area */}
        <div className={styles.trackArea}>
          {/* Time labels */}
          <div className={styles.timeLabels}>
            <span className={styles.startLabel}>
              {fmtTime(timelineStartTime)}
            </span>
            {timeLabels.map(({ label, pct }) => (
              <span
                key={`${label}-${pct.toFixed(1)}`}
                className={styles.midLabel}
                style={{ left: `${pct}%` }}
              >
                {label}
              </span>
            ))}
            <span className={styles.endLabel}>Bây giờ</span>
          </div>

          {/* Scrubbing track */}
          <div
            ref={timelineRef}
            className={`${styles.track} ${isHoveringTrack || isDragging ? styles.trackExpanded : ""} ${!canSeek ? styles.trackDisabled : ""}`}
            onPointerDown={canSeek ? handlePointerDown : undefined}
            onPointerMove={canSeek ? handlePointerMove : undefined}
            onPointerUp={canSeek ? handlePointerUp : undefined}
            onMouseMove={canSeek ? handleMouseMove : undefined}
            onMouseEnter={canSeek ? handleMouseEnter : undefined}
            onMouseLeave={canSeek ? handleMouseLeave : undefined}
          >
            {/* Progress fill */}
            <div
              className={`${styles.progressPlayed} ${mode === "dvr" ? styles.progressDvr : ""}`}
              style={{ width: `${Math.min(100, Math.max(0, playheadPct))}%` }}
            />

            {/* Hover fill */}
            {hoverPercent !== null && !isDragging && canSeek && (
              <div
                className={styles.hoverFill}
                style={{ width: `${hoverPercent}%` }}
              />
            )}

            {/* Playhead dot */}
            <div
              className={`${styles.playhead} ${isDragging ? styles.playheadDragging : ""} ${isHoveringTrack || isDragging ? styles.playheadVisible : ""} ${mode === "live" ? styles.playheadLive : styles.playheadDvr}`}
              style={{ left: `${Math.min(100, Math.max(0, playheadPct))}%` }}
            />
          </div>
        </div>

        {/* Bottom status row */}
        <div className={styles.bottomRow}>
          <div className={styles.bottomLeft}>
            {mode === "dvr" && dvrOffsetFromLive > 0 ? (
              <span className={styles.dvrLabel}>
                📼 Đang xem:{" "}
                {fmtDateTime(new Date(Date.now() - dvrOffsetFromLive * 1000))}
              </span>
            ) : canSeek ? (
              <span className={styles.liveHint}>Kéo timeline để xem lại</span>
            ) : (
              <span className={styles.liveHint}>⏳ Đợi thêm vài giây...</span>
            )}
          </div>
          <div className={styles.bottomRight}>
            {mode === "live" ? (
              <span className={styles.livePill}>
                <span className={styles.livePillDot} />
                TRỰC TIẾP
              </span>
            ) : (
              <button
                className={styles.goLivePill}
                onClick={goLive}
                title="Về xem trực tiếp"
              >
                <span className={styles.goLivePillDot} />
                Về LIVE
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
