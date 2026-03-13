"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./CameraPlayer.module.css";

export interface RecordingSegment {
  start: string; // ISO 8601
  duration: number; // seconds
  durationLabel: string;
  label: string;
  url: string;
}

interface CameraPlayerProps {
  cameraId: string;
  cameraName: string;
  streamUrl: string; // WHEP URL
  segments: RecordingSegment[]; // sorted newest-first from backend
  playbackBaseUrl: string; // e.g. http://localhost:9996
  playbackToken: string;
  onClose: () => void;
}

type Mode = "live" | "dvr";
type LiveStatus = "connecting" | "playing" | "error";

function sortOldestFirst(segs: RecordingSegment[]): RecordingSegment[] {
  return [...segs].sort(
    (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime(),
  );
}

function fmtTime(d: Date) {
  return d.toLocaleTimeString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
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

export default function CameraPlayer({
  cameraId,
  cameraName,
  streamUrl,
  segments,
  playbackBaseUrl,
  playbackToken,
  onClose,
}: CameraPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const dvrClipStartRef = useRef<Date | null>(null);

  const [mode, setMode] = useState<Mode>("live");
  const [liveStatus, setLiveStatus] = useState<LiveStatus>("connecting");
  const [errorMsg, setErrorMsg] = useState("");
  const [dvrTime, setDvrTime] = useState<Date | null>(null);
  const [nowTime, setNowTime] = useState(() => new Date());
  const [isDragging, setIsDragging] = useState(false);
  const [dragPercent, setDragPercent] = useState<number | null>(null);

  // Sorted oldest → newest for timeline drawing
  const sortedSegs = sortOldestFirst(segments);
  const timelineStart =
    sortedSegs.length > 0 ? new Date(sortedSegs[0].start) : null;
  const timelineEnd = nowTime;
  const timelineMs = timelineStart
    ? timelineEnd.getTime() - timelineStart.getTime()
    : 0;

  // Refresh "now" so live edge keeps moving
  useEffect(() => {
    const id = setInterval(() => setNowTime(new Date()), 5000);
    return () => clearInterval(id);
  }, []);

  // Track DVR current time from video.currentTime
  useEffect(() => {
    if (mode !== "dvr") return;
    const video = videoRef.current;
    if (!video) return;
    const onTimeUpdate = () => {
      if (dvrClipStartRef.current) {
        setDvrTime(
          new Date(
            dvrClipStartRef.current.getTime() + video.currentTime * 1000,
          ),
        );
      }
    };
    video.addEventListener("timeupdate", onTimeUpdate);
    return () => video.removeEventListener("timeupdate", onTimeUpdate);
  }, [mode]);

  // ── WebRTC LIVE ──────────────────────────────────────────
  useEffect(() => {
    if (mode !== "live") return;

    const video = videoRef.current;
    if (video) {
      video.src = "";
      video.load();
      video.muted = true;
    }
    setLiveStatus("connecting");
    setErrorMsg("");
    let cancelled = false;

    async function connectWhep() {
      try {
        const pc = new RTCPeerConnection({
          iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
        });
        pcRef.current = pc;

        pc.addTransceiver("video", { direction: "recvonly" });
        pc.addTransceiver("audio", { direction: "recvonly" });

        pc.ontrack = (e) => {
          if (cancelled || !videoRef.current) return;
          if (e.streams[0]) videoRef.current.srcObject = e.streams[0];
        };

        pc.oniceconnectionstatechange = () => {
          if (cancelled) return;
          const s = pc.iceConnectionState;
          if (s === "connected" || s === "completed") setLiveStatus("playing");
          else if (s === "failed" || s === "disconnected" || s === "closed") {
            setLiveStatus("error");
            setErrorMsg(`ICE: ${s}`);
          }
        };

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        await new Promise<void>((resolve) => {
          if (pc.iceGatheringState === "complete") return resolve();
          const fn = () => {
            if (pc.iceGatheringState === "complete") {
              pc.removeEventListener("icegatheringstatechange", fn);
              resolve();
            }
          };
          pc.addEventListener("icegatheringstatechange", fn);
          setTimeout(resolve, 5000);
        });

        if (cancelled) return;

        const res = await fetch(streamUrl, {
          method: "POST",
          headers: { "Content-Type": "application/sdp" },
          body: pc.localDescription!.sdp,
        });
        if (!res.ok) throw new Error(`WHEP ${res.status}`);

        const answerSdp = await res.text();
        if (cancelled) return;
        await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
      } catch (err: unknown) {
        if (!cancelled) {
          setLiveStatus("error");
          setErrorMsg(
            err instanceof Error ? err.message : "Lỗi không xác định",
          );
        }
      }
    }

    connectWhep();

    return () => {
      cancelled = true;
      if (pcRef.current) {
        pcRef.current.close();
        pcRef.current = null;
      }
      const v = videoRef.current;
      if (v) v.srcObject = null;
    };
  }, [mode, streamUrl]);

  // ── Seek to a time T → switch to DVR ────────────────────
  const seekToTime = useCallback(
    (t: Date) => {
      if (!timelineStart) return;

      // Find segment that contains t
      let target = sortedSegs.find((seg) => {
        const s = new Date(seg.start).getTime();
        const e = s + seg.duration * 1000;
        return t.getTime() >= s && t.getTime() < e;
      });

      // If not in any segment, snap to the nearest segment start
      if (!target) {
        target = sortedSegs.reduce((prev, cur) => {
          const pd = Math.abs(t.getTime() - new Date(prev.start).getTime());
          const cd = Math.abs(t.getTime() - new Date(cur.start).getTime());
          return cd < pd ? cur : prev;
        });
        t = new Date(target.start);
      }

      // Close existing WebRTC
      if (pcRef.current) {
        pcRef.current.close();
        pcRef.current = null;
      }

      const video = videoRef.current;
      if (!video) return;

      // Remaining seconds in this segment from t
      const segEnd = new Date(target.start).getTime() + target.duration * 1000;
      const remaining = Math.max(60, Math.ceil((segEnd - t.getTime()) / 1000));

      const url =
        `${playbackBaseUrl}/get` +
        `?path=${encodeURIComponent(cameraId)}` +
        `&start=${encodeURIComponent(t.toISOString())}` +
        `&duration=${remaining}` +
        `&token=${playbackToken}`;

      dvrClipStartRef.current = t;
      video.srcObject = null;
      video.muted = false;
      video.src = url;
      video.load();
      video.play().catch(() => {});

      setMode("dvr");
      setDvrTime(t);
    },
    [sortedSegs, playbackBaseUrl, cameraId, playbackToken, timelineStart],
  );

  // ── Go back to LIVE ──────────────────────────────────────
  const goLive = useCallback(() => {
    setMode("live");
    setDvrTime(null);
    dvrClipStartRef.current = null;
  }, []);

  // ── Timeline helpers ─────────────────────────────────────
  const timeToPercent = useCallback(
    (t: Date) => {
      if (!timelineStart || timelineMs <= 0) return 100;
      return ((t.getTime() - timelineStart.getTime()) / timelineMs) * 100;
    },
    [timelineStart, timelineMs],
  );

  const percentToTime = useCallback(
    (pct: number): Date | null => {
      if (!timelineStart || timelineMs <= 0) return null;
      return new Date(timelineStart.getTime() + (pct / 100) * timelineMs);
    },
    [timelineStart, timelineMs],
  );

  const clientXToPercent = useCallback((clientX: number) => {
    const el = timelineRef.current;
    if (!el) return 100;
    const rect = el.getBoundingClientRect();
    return Math.max(
      0,
      Math.min(100, ((clientX - rect.left) / rect.width) * 100),
    );
  }, []);

  // ── Pointer events (mouse + touch) ──────────────────────
  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!timelineStart) return;
      timelineRef.current?.setPointerCapture(e.pointerId);
      setIsDragging(true);
      setDragPercent(clientXToPercent(e.clientX));
      e.preventDefault();
    },
    [timelineStart, clientXToPercent],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDragging) return;
      setDragPercent(clientXToPercent(e.clientX));
    },
    [isDragging, clientXToPercent],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!isDragging) return;
      setIsDragging(false);
      const pct = clientXToPercent(e.clientX);
      setDragPercent(null);
      if (pct >= 98) {
        goLive();
      } else {
        const t = percentToTime(pct);
        if (t) seekToTime(t);
      }
    },
    [isDragging, clientXToPercent, percentToTime, seekToTime, goLive],
  );

  // ── Playhead position ────────────────────────────────────
  const playheadPct =
    dragPercent !== null
      ? dragPercent
      : mode === "live"
        ? 100
        : dvrTime
          ? timeToPercent(dvrTime)
          : 100;

  // ── Time labels on track ─────────────────────────────────
  const getHourLabels = (): { t: Date; pct: number }[] => {
    if (!timelineStart || timelineMs <= 0) return [];
    const labels: { t: Date; pct: number }[] = [];
    const hourMs = 3_600_000;
    let cur = new Date(Math.ceil(timelineStart.getTime() / hourMs) * hourMs);
    while (cur.getTime() < timelineEnd.getTime() - hourMs * 0.3) {
      const pct =
        ((cur.getTime() - timelineStart.getTime()) / timelineMs) * 100;
      if (pct > 2 && pct < 96) labels.push({ t: cur, pct });
      cur = new Date(cur.getTime() + hourMs);
    }
    return labels;
  };

  const hourLabels = getHourLabels();

  return (
    <div className={styles.container}>
      {/* ── Header ─────────────────────────────────────────── */}
      <div className={styles.header}>
        <div className={styles.info}>
          {mode === "live" ? (
            <span className={`${styles.dot} ${styles[liveStatus]}`} />
          ) : (
            <span className={styles.dvrIcon}>⏪</span>
          )}
          <span className={styles.name}>{cameraName}</span>
          <span className={styles.statusLabel}>
            {mode === "live"
              ? liveStatus === "connecting"
                ? "⏳ Đang kết nối..."
                : liveStatus === "playing"
                  ? "🔴 LIVE"
                  : "⚠️ Lỗi kết nối"
              : dvrTime
                ? `📼 ${fmtDateTime(dvrTime)}`
                : "📼 Đang tải..."}
          </span>
        </div>
        <div className={styles.headerActions}>
          {mode === "dvr" && (
            <button className={styles.goLiveBtn} onClick={goLive}>
              ⏩ Về LIVE
            </button>
          )}
          <button className={styles.closeBtn} onClick={onClose}>
            ✕ Đóng
          </button>
        </div>
      </div>

      {/* ── Error ──────────────────────────────────────────── */}
      {mode === "live" && liveStatus === "error" && (
        <div className={styles.errorBar} role="alert">
          ⚠️ {errorMsg}
        </div>
      )}

      {/* ── Video ──────────────────────────────────────────── */}
      <div className={styles.videoWrapper}>
        {mode === "live" && liveStatus === "connecting" && (
          <div className={styles.overlay}>
            <div className={styles.spinner} />
            <p>Đang thiết lập luồng WebRTC...</p>
          </div>
        )}
        <video
          ref={videoRef}
          autoPlay
          controls
          playsInline
          className={styles.video}
        />
      </div>

      {/* ── DVR Timeline (only when recordings exist) ─────── */}
      {sortedSegs.length > 0 && timelineStart && (
        <div className={styles.dvrBar}>
          {/* Time stamp labels */}
          <div className={styles.labelRow}>
            <span className={styles.edgeLabel}>{fmtTime(timelineStart)}</span>
            {hourLabels.map(({ t, pct }) => (
              <span
                key={t.toISOString()}
                className={styles.midLabel}
                style={{ left: `${pct}%` }}
              >
                {fmtTime(t)}
              </span>
            ))}
            <span className={`${styles.edgeLabel} ${styles.liveEdge}`}>
              LIVE
            </span>
          </div>

          {/* Track */}
          <div
            ref={timelineRef}
            className={`${styles.track} ${isDragging ? styles.trackDragging : ""}`}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
          >
            {/* Segment blocks (filled blue = recorded) */}
            {sortedSegs.map((seg) => {
              const left = timeToPercent(new Date(seg.start));
              const width = ((seg.duration * 1000) / timelineMs) * 100;
              return (
                <div
                  key={seg.start}
                  className={styles.segBlock}
                  style={{
                    left: `${left}%`,
                    width: `${Math.max(0.3, width)}%`,
                  }}
                />
              );
            })}

            {/* Playhead handle */}
            <div
              className={`${styles.playhead} ${isDragging ? styles.playheadDragging : ""} ${mode === "live" ? styles.playheadLive : ""}`}
              style={{ left: `${Math.min(100, Math.max(0, playheadPct))}%` }}
            >
              {mode === "live" && <span className={styles.liveTag}>LIVE</span>}
            </div>
          </div>

          {/* Current time / status row */}
          <div className={styles.timeRow}>
            {dragPercent !== null && percentToTime(dragPercent) ? (
              <span className={styles.seekPreview}>
                🔍 {fmtDateTime(percentToTime(dragPercent)!)}
              </span>
            ) : mode === "dvr" && dvrTime ? (
              <span className={styles.dvrTimeText}>
                📼 Đang xem: {fmtDateTime(dvrTime)}
              </span>
            ) : (
              <span className={styles.liveTimeText}>
                🔴 Đang phát LIVE &nbsp;·&nbsp; Kéo thanh để xem lại
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
