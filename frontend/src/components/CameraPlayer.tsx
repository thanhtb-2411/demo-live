"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./CameraPlayer.module.css";

interface CameraPlayerProps {
  cameraId: string;
  cameraName: string;
  streamUrl: string; // WHEP URL for live WebRTC
  dvrWindowSeconds: number; // Max DVR window (config-based)
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

/** Human-readable relative time */
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
  const logDiag = (...args: unknown[]) => {
    console.log("[WebRTC-DIAG]", ...args);
  };

  const warnDiag = (...args: unknown[]) => {
    console.warn("[WebRTC-DIAG]", ...args);
  };

  // ── Refs ──────────────────────────────────────────────────
  const liveVideoRef = useRef<HTMLVideoElement>(null);
  const dvrVideoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  // WebM init segment (chunk 0): phải luôn được giữ để blob có header hợp lệ
  const initChunkRef = useRef<Blob | null>(null);
  // Data chunks (chunk 1+): được trim để giới hạn 5 phút
  const chunksRef = useRef<Blob[]>([]);
  const objectUrlRef = useRef<string | null>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const streamStartRef = useRef<number>(Date.now()); // khi user bắt đầu xem
  const modeRef = useRef<Mode>("live");
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statsTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const retryCountRef = useRef<number>(0);
  const prevInboundVideoStatsRef = useRef<{
    timestamp: number;
    bytesReceived?: number;
    packetsReceived?: number;
    framesDecoded?: number;
    keyFramesDecoded?: number;
  } | null>(null);

  // ── State ─────────────────────────────────────────────────
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
  const [retryKey, setRetryKey] = useState(0);

  // For correctly tracking timeline while in closure
  const timelineSecRef = useRef<number>(0);

  // ── Timeline: only shows what’s actually in the buffer ───────
  const nowMs = nowTime.getTime();
  const maxWindowMs = dvrWindowSeconds * 1000;
  const elapsedMs = nowMs - streamStartRef.current;
  // Cap to actual buffer size (chunks.length ≈ seconds recorded)
  const bufferMs = Math.min(chunksRef.current.length * 1000, maxWindowMs);
  const timelineMs = Math.max(
    1000,
    Math.min(elapsedMs, bufferMs || maxWindowMs),
  );
  const streamStartMs = nowMs - timelineMs; // left edge of visible timeline
  const timelineSec = timelineMs / 1000;
  timelineSecRef.current = timelineSec;

  // Refresh "now" every 2s so timeline keeps growing
  useEffect(() => {
    const id = setInterval(() => setNowTime(new Date()), 2000);
    return () => clearInterval(id);
  }, []);

  // ═══════════════════════════════════════════════════════════
  // WebRTC LIVE – always connects on mount
  // ═══════════════════════════════════════════════════════════
  useEffect(() => {
    const video = liveVideoRef.current;
    if (video) {
      video.srcObject = null;
      video.muted = true;
    }
    setLiveStatus("connecting");
    setErrorMsg("");
    logDiag("connect:start", {
      cameraName,
      streamUrl,
      retryKey,
    });
    let cancelled = false;

    const scheduleReconnect = (delaySec: number) => {
      if (cancelled) return;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = setTimeout(() => {
        if (!cancelled) {
          retryCountRef.current += 1;
          setRetryKey((k) => k + 1);
        }
      }, delaySec * 1000);
    };

    async function connectWhep() {
      try {
        const pc = new RTCPeerConnection({
          iceServers: [
            {
              urls: [
                "stun:stun.l.google.com:19302",
                "stun:stun1.l.google.com:19302",
              ],
            },
            { urls: "stun:stun.cloudflare.com:3478" },
          ],
          iceTransportPolicy: "all",
          bundlePolicy: "max-bundle",
          rtcpMuxPolicy: "require",
        });
        pcRef.current = pc;

        pc.onconnectionstatechange = () => {
          logDiag("pc:connectionState", pc.connectionState);
        };

        pc.onsignalingstatechange = () => {
          logDiag("pc:signalingState", pc.signalingState);
        };

        pc.onicegatheringstatechange = () => {
          logDiag("pc:iceGatheringState", pc.iceGatheringState);
        };

        pc.onicecandidateerror = (event) => {
          warnDiag("pc:iceCandidateError", {
            address: event.address,
            port: event.port,
            url: event.url,
            errorCode: event.errorCode,
            errorText: event.errorText,
          });
        };

        pc.addTransceiver("video", { direction: "recvonly" });
        pc.addTransceiver("audio", { direction: "recvonly" });

        pc.ontrack = (e) => {
          if (cancelled || !liveVideoRef.current) return;
          const stream = e.streams[0];
          if (!stream) return;
          const liveVideo = liveVideoRef.current;
          if (liveVideo.srcObject !== stream) {
            liveVideo.srcObject = stream;
          }
          liveVideo
            .play()
            .then(() => logDiag("video:play-call:ok"))
            .catch((playErr) => warnDiag("video:play-call:error", playErr));
          logDiag("track:received", {
            kind: e.track.kind,
            id: e.track.id,
            muted: e.track.muted,
            readyState: e.track.readyState,
            settings: e.track.getSettings?.(),
          });

          // Start in-memory recording for DVR
          if (!mediaRecorderRef.current) {
            chunksRef.current = [];
            const mimeType = MediaRecorder.isTypeSupported(
              "video/webm;codecs=vp8,opus",
            )
              ? "video/webm;codecs=vp8,opus"
              : MediaRecorder.isTypeSupported("video/webm")
                ? "video/webm"
                : "";
            try {
              const mr = new MediaRecorder(
                stream,
                mimeType ? { mimeType } : {},
              );
              mediaRecorderRef.current = mr;
              mr.ondataavailable = (ev) => {
                if (ev.data && ev.data.size > 0) {
                  if (!initChunkRef.current) {
                    // Chunk đầu tiên luôn là WebM init segment – giữ riêng
                    initChunkRef.current = ev.data;
                  } else {
                    chunksRef.current.push(ev.data);
                    // Trim: chỉ giữ tối đa dvrWindowSeconds data chunks
                    const maxChunks = Math.max(10, dvrWindowSeconds);
                    if (chunksRef.current.length > maxChunks) {
                      chunksRef.current = chunksRef.current.slice(
                        chunksRef.current.length - maxChunks,
                      );
                    }
                  }
                }
              };
              mr.start(1000); // collect a chunk every 1 s
            } catch (err) {
              console.warn("MediaRecorder không khởi động được:", err);
            }
          }
        };

        pc.oniceconnectionstatechange = () => {
          if (cancelled) return;
          const s = pc.iceConnectionState;
          logDiag("pc:iceConnectionState", s);
          if (s === "connected" || s === "completed") {
            retryCountRef.current = 0;
            if (reconnectTimerRef.current) {
              clearTimeout(reconnectTimerRef.current);
              reconnectTimerRef.current = null;
            }
            setLiveStatus("playing");

            if (statsTimerRef.current) {
              clearInterval(statsTimerRef.current);
              statsTimerRef.current = null;
            }

            statsTimerRef.current = setInterval(async () => {
              if (!pcRef.current) return;
              try {
                const report = await pcRef.current.getStats();
                report.forEach((r) => {
                  if (r.type === "inbound-rtp" && r.kind === "video") {
                    const prev = prevInboundVideoStatsRef.current;
                    let derived: Record<string, number> | undefined;

                    if (prev && r.timestamp > prev.timestamp) {
                      const dtSec = (r.timestamp - prev.timestamp) / 1000;
                      if (dtSec > 0) {
                        const deltaBytes =
                          (r.bytesReceived ?? 0) - (prev.bytesReceived ?? 0);
                        const deltaPackets =
                          (r.packetsReceived ?? 0) - (prev.packetsReceived ?? 0);
                        const deltaFrames =
                          (r.framesDecoded ?? 0) - (prev.framesDecoded ?? 0);
                        const deltaKeyFrames =
                          (r.keyFramesDecoded ?? 0) -
                          (prev.keyFramesDecoded ?? 0);

                        derived = {
                          bitrateKbps: Number(((deltaBytes * 8) / dtSec / 1000).toFixed(1)),
                          packetsPerSec: Number((deltaPackets / dtSec).toFixed(1)),
                          decodedFps: Number((deltaFrames / dtSec).toFixed(2)),
                          keyFramesPerSec: Number((deltaKeyFrames / dtSec).toFixed(2)),
                        };
                      }
                    }

                    prevInboundVideoStatsRef.current = {
                      timestamp: r.timestamp,
                      bytesReceived: r.bytesReceived,
                      packetsReceived: r.packetsReceived,
                      framesDecoded: r.framesDecoded,
                      keyFramesDecoded: r.keyFramesDecoded,
                    };

                    logDiag("stats:inbound-video", {
                      timestamp: r.timestamp,
                      packetsReceived: r.packetsReceived,
                      packetsLost: r.packetsLost,
                      jitter: r.jitter,
                      bytesReceived: r.bytesReceived,
                      framesDecoded: r.framesDecoded,
                      framesDropped: r.framesDropped,
                      framesPerSecond: r.framesPerSecond,
                      keyFramesDecoded: r.keyFramesDecoded,
                      pliCount: r.pliCount,
                      firCount: r.firCount,
                      nackCount: r.nackCount,
                      ...derived,
                    });
                  }
                });
              } catch (statsErr) {
                warnDiag("stats:error", statsErr);
              }
            }, 2000);
          } else if (s === "disconnected") {
            // Transient – give 5 s to self-heal before reconnecting
            scheduleReconnect(5);
          } else if (s === "failed") {
            // Hard failure – reconnect immediately
            scheduleReconnect(1);
          } else if (s === "closed") {
            setLiveStatus("error");
            setErrorMsg("ICE: closed");
          }
        };

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        logDiag("sdp:offer-created", {
          hasLocalDescription: Boolean(pc.localDescription?.sdp),
          type: pc.localDescription?.type,
        });

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

        // 1. Tạo chuỗi xác thực (User:Pass)
        const credentials = `viewer:viewer123`;

        // 2. Mã hóa Base64 (dùng btoa trong trình duyệt hoặc Buffer trong Node.js)
        const authHeader = btoa(credentials); // Nếu chạy trên Browser

        const res = await fetch(streamUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/sdp",
            // 3. Thêm Header Authorization đúng chuẩn
            Authorization: `Basic ${authHeader}`,
          },
          body: pc.localDescription!.sdp,
        });

        logDiag("whep:post-response", {
          status: res.status,
          ok: res.ok,
          id: res.headers.get("id"),
          location: res.headers.get("location"),
        });

        if (!res.ok) throw new Error(`WHEP ${res.status}`);

        const answerSdp = await res.text();
        if (cancelled) return;
        await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
        logDiag("sdp:answer-applied", {
          answerLength: answerSdp.length,
        });
      } catch (err: unknown) {
        if (!cancelled) {
          warnDiag("connect:error", err);
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
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (statsTimerRef.current) {
        clearInterval(statsTimerRef.current);
        statsTimerRef.current = null;
      }
      prevInboundVideoStatsRef.current = null;
      if (mediaRecorderRef.current) {
        try {
          mediaRecorderRef.current.stop();
        } catch {
          /* ignore */
        }
        mediaRecorderRef.current = null;
      }
      if (pcRef.current) {
        pcRef.current.close();
        pcRef.current = null;
      }
      const v = liveVideoRef.current;
      if (v) v.srcObject = null;
      logDiag("connect:cleanup");
    };
  }, [cameraName, streamUrl, retryKey]);

  // Log HTMLVideoElement lifecycle to separate transport issues from render/decode issues.
  useEffect(() => {
    const video = liveVideoRef.current;
    if (!video) return;

    const onLoadedMetadata = () => {
      logDiag("video:event:loadedmetadata", {
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
        readyState: video.readyState,
      });
    };
    const onCanPlay = () => logDiag("video:event:canplay");
    const onPlaying = () => {
      logDiag("video:event:playing", {
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
        currentTime: Number(video.currentTime.toFixed(3)),
      });
    };
    const onWaiting = () => warnDiag("video:event:waiting");
    const onStalled = () => warnDiag("video:event:stalled");
    const onPause = () => logDiag("video:event:pause");
    const onError = () => {
      const mediaError = video.error;
      warnDiag("video:event:error", {
        code: mediaError?.code,
        message: mediaError?.message,
      });
    };

    video.addEventListener("loadedmetadata", onLoadedMetadata);
    video.addEventListener("canplay", onCanPlay);
    video.addEventListener("playing", onPlaying);
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("stalled", onStalled);
    video.addEventListener("pause", onPause);
    video.addEventListener("error", onError);

    return () => {
      video.removeEventListener("loadedmetadata", onLoadedMetadata);
      video.removeEventListener("canplay", onCanPlay);
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("stalled", onStalled);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("error", onError);
    };
  }, []);

  // ── Cleanup MediaRecorder + blob URL on unmount ──────────
  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current) {
        try {
          mediaRecorderRef.current.stop();
        } catch {
          /* ignore */
        }
        mediaRecorderRef.current = null;
      }
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
      chunksRef.current = [];
      initChunkRef.current = null;
    };
  }, []);

  // ── Frozen stream detector: reconnect if no video progress for 20s in live mode ──
  useEffect(() => {
    if (liveStatus !== "playing") return;
    const video = liveVideoRef.current;
    if (!video) return;

    let lastTime = -1;
    let stalledCount = 0;
    const id = setInterval(() => {
      if (modeRef.current !== "live") return;
      const t = video.currentTime;
      const quality =
        typeof video.getVideoPlaybackQuality === "function"
          ? video.getVideoPlaybackQuality()
          : null;

      logDiag("video:playback", {
        currentTime: Number(t.toFixed(3)),
        paused: video.paused,
        readyState: video.readyState,
        networkState: video.networkState,
        droppedVideoFrames: quality?.droppedVideoFrames,
        totalVideoFrames: quality?.totalVideoFrames,
      });

      if (lastTime >= 0 && t === lastTime && !video.paused) {
        stalledCount += 1;
        warnDiag("video:stalled", {
          currentTime: t,
          stalledCount,
        });
        // Video không tiến sau 20s → stream bị đóng băng, reconnect
        retryCountRef.current += 1;
        setRetryKey((k) => k + 1);
      } else {
        stalledCount = 0;
      }
      lastTime = t;
    }, 20_000);

    return () => clearInterval(id);
  }, [liveStatus]);

  // Track DVR offset: blobDuration - currentTime
  useEffect(() => {
    if (mode !== "dvr") return;
    const video = dvrVideoRef.current;
    if (!video) return;

    const onTimeUpdate = () => {
      const blobDuration = timelineSecRef.current;
      const offset = Math.max(0, blobDuration - video.currentTime);
      setDvrOffsetFromLive(offset);
    };

    video.addEventListener("timeupdate", onTimeUpdate);
    return () => video.removeEventListener("timeupdate", onTimeUpdate);
  }, [mode]);

  // ── Seek within the in-memory blob to an offset from live edge ──
  // onDone is called once the seek (and any duration-discovery seek) finishes.
  const seekDvr = useCallback((offsetFromLive: number, onDone?: () => void) => {
    const video = dvrVideoRef.current;
    if (!video) {
      onDone?.();
      return;
    }
    // Dùng số chunk thực tế làm duration, không dùng timelineSec
    const blobDurationSec = chunksRef.current.length;
    const targetTime = Math.max(0, blobDurationSec - offsetFromLive);

    // Seek to targetTime and fire onDone after seeked completes
    const doSeekTo = (t: number) => {
      if (onDone) {
        const onSeeked = () => {
          video.removeEventListener("seeked", onSeeked);
          onDone();
        };
        video.addEventListener("seeked", onSeeked);
      }
      video.currentTime = t;
    };

    if (isFinite(video.duration) && video.duration > 0) {
      doSeekTo(Math.min(targetTime, video.duration));
    } else {
      // WebM from MediaRecorder lacks duration metadata (duration = Infinity).
      // Seek to 9999 first so the browser indexes the stream, then seek to target.
      const onFirst = () => {
        video.removeEventListener("seeked", onFirst);
        doSeekTo(targetTime);
      };
      video.addEventListener("seeked", onFirst);
      video.currentTime = 9999;
    }
  }, []);

  // ── Switch to DVR — snapshot current chunks into a Blob URL ──
  const switchToDvr = useCallback(
    (offsetFromLive: number) => {
      const video = dvrVideoRef.current;
      if (!video || chunksRef.current.length === 0 || !initChunkRef.current)
        return;

      // Revoke previous blob to avoid memory leaks
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }

      const mimeType = mediaRecorderRef.current?.mimeType || "video/webm";
      // Luôn gồm init chunk đầu tiên để blob có WebM header hợp lệ
      const blob = new Blob([initChunkRef.current, ...chunksRef.current], {
        type: mimeType,
      });
      const url = URL.createObjectURL(blob);
      objectUrlRef.current = url;

      setDvrOffsetFromLive(offsetFromLive);
      setModeSync("dvr");

      video.src = url;
      video.muted = false;
      video.onloadedmetadata = () => {
        video.onloadedmetadata = null;
        // Only play AFTER the seek fully completes to avoid playing from position 0
        seekDvr(offsetFromLive, () => {
          video.play().catch(() => {});
        });
      };
      video.load();
    },
    [seekDvr],
  );

  // ── Go back to LIVE — release blob URL and clear dvr video ──
  const goLive = useCallback(() => {
    const dvrVideo = dvrVideoRef.current;
    if (dvrVideo) {
      dvrVideo.pause();
      dvrVideo.onloadedmetadata = null;
      dvrVideo.src = "";
      dvrVideo.load();
    }
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    setDvrOffsetFromLive(0);
    setModeSync("live");
  }, []);

  // ── Timeline helpers ─────────────────────────────────────
  // pct 0% = streamStart (left), pct 100% = now/LIVE (right)

  const percentToOffset = useCallback(
    (pct: number): number => {
      return (1 - pct / 100) * timelineSec;
    },
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
    (pct: number): Date => {
      return new Date(streamStartMs + (pct / 100) * timelineMs);
    },
    [streamStartMs, timelineMs],
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

  // ── Pointer events ──────────────────────────────────────
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
      if (isDragging) {
        setDragPercent(clientXToPercent(e.clientX));
      }
    },
    [isDragging, clientXToPercent],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!isDragging) return;
      setIsDragging(false);
      const pct = clientXToPercent(e.clientX);
      setDragPercent(null);

      const offsetFromLive = percentToOffset(pct);

      if (offsetFromLive <= 3) {
        // Close to live edge → go live
        goLive();
      } else if (modeRef.current === "dvr") {
        // Already in DVR: just seek within the existing blob, no reload
        seekDvr(offsetFromLive);
      } else {
        // First time switching live → DVR: snapshot chunks and load blob
        switchToDvr(offsetFromLive);
      }
    },
    [
      isDragging,
      clientXToPercent,
      percentToOffset,
      goLive,
      seekDvr,
      switchToDvr,
    ],
  );

  // Hover tracking
  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isDragging) {
        setHoverPercent(clientXToPercent(e.clientX));
      }
    },
    [isDragging, clientXToPercent],
  );

  const handleMouseEnter = useCallback(() => setIsHoveringTrack(true), []);
  const handleMouseLeave = useCallback(() => {
    setIsHoveringTrack(false);
    setHoverPercent(null);
  }, []);

  // ── Playhead position ────────────────────────────────────
  const playheadPct =
    dragPercent !== null
      ? dragPercent
      : mode === "live"
        ? 100
        : offsetToPercent(dvrOffsetFromLive);

  // ── Time labels on timeline ──────────────────────────────
  const getTimeLabels = (): { label: string; pct: number }[] => {
    if (timelineSec <= 5) return []; // too short to show labels
    const labels: { label: string; pct: number }[] = [];

    // Adaptive intervals based on how long user has been watching
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

  // Timeline is interactive once we have enough recorded chunks
  const canSeek = timelineSec > 5 && chunksRef.current.length > 0;

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
      {liveStatus === "error" && mode === "live" && (
        <div className={styles.errorBar} role="alert">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 10.5a.75.75 0 110-1.5.75.75 0 010 1.5zM8.75 4.75v4a.75.75 0 01-1.5 0v-4a.75.75 0 011.5 0z" />
          </svg>
          <span>{errorMsg}</span>
        </div>
      )}

      {/* ── Video Area ─────────────────────────────────────── */}
      <div className={styles.videoWrapper}>
        {/* Loading overlay — only when WebRTC is connecting in live mode */}
        {mode === "live" && liveStatus === "connecting" && (
          <div className={styles.overlay}>
            <div className={styles.spinner} />
            <p>
              {retryKey > 0
                ? `Đang kết nối lại... (lần ${retryKey})`
                : "Đang thiết lập luồng WebRTC..."}
            </p>
          </div>
        )}

        {/* WebRTC live video */}
        <video
          ref={liveVideoRef}
          autoPlay
          muted
          playsInline
          className={`${styles.video} ${mode !== "live" ? styles.videoHidden : ""}`}
        />

        {/* DVR playback video (in-memory blob) */}
        <video
          ref={dvrVideoRef}
          playsInline
          className={`${styles.video} ${mode !== "dvr" ? styles.videoHidden : ""}`}
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

          {/* The scrubbing track */}
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
