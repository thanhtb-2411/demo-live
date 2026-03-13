"use client";

import { useCallback, useState } from "react";
import CameraPlayer, { RecordingSegment } from "./CameraPlayer";
import styles from "./CameraViewer.module.css";

interface Camera {
  id: string;
  name: string;
}

export default function CameraViewer({
  initialCameras,
}: {
  initialCameras: Camera[];
}) {
  const [activeCamera, setActiveCamera] = useState<Camera | null>(null);
  const [streamUrl, setStreamUrl] = useState<string>("");
  const [segments, setSegments] = useState<RecordingSegment[]>([]);
  const [playbackBaseUrl, setPlaybackBaseUrl] = useState<string>("");
  const [playbackToken, setPlaybackToken] = useState<string>("");
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string>("");

  /**
   * Khi click camera: fetch live URL và recordings song song.
   * Player dùng live làm mặc định; nếu có recordings thì hiển thị
   * thanh timeline ở dưới để user click xem lại.
   */
  const handleCameraClick = useCallback(async (camera: Camera) => {
    setLoadingId(camera.id);
    setError("");
    setActiveCamera(null);
    setStreamUrl("");
    setSegments([]);
    setPlaybackBaseUrl("");
    setPlaybackToken("");

    try {
      const [liveRes, recRes] = await Promise.all([
        fetch(`/api/cameras/${camera.id}/live`),
        fetch(`/api/cameras/${camera.id}/recordings`),
      ]);

      if (!liveRes.ok) {
        const body = await liveRes.json().catch(() => ({}));
        throw new Error(body?.message || `HTTP ${liveRes.status}`);
      }

      const liveData = await liveRes.json();
      const recData = recRes.ok
        ? await recRes.json()
        : { recordings: [], playbackBaseUrl: "", token: "" };

      setStreamUrl(liveData.streamUrl);
      setSegments(recData.recordings ?? []);
      setPlaybackBaseUrl(recData.playbackBaseUrl ?? "");
      setPlaybackToken(recData.token ?? "");
      setActiveCamera(camera);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Lỗi không xác định";
      setError(`Không thể kết nối "${camera.name}": ${msg}`);
    } finally {
      setLoadingId(null);
    }
  }, []);

  const handleClose = useCallback(() => {
    setActiveCamera(null);
    setStreamUrl("");
    setSegments([]);
    setPlaybackBaseUrl("");
    setPlaybackToken("");
    setError("");
  }, []);

  return (
    <div className={styles.container}>
      {/* ── Header ─────────────────────────────────────────── */}
      <header className={styles.header}>
        <h1 className={styles.title}>🎥 Hệ Thống Camera Live Stream</h1>
        <p className={styles.subtitle}>
          WebRTC (WHEP) + MediaMTX &nbsp;|&nbsp; Passthrough – CPU ~0%
          &nbsp;|&nbsp; Độ trễ &lt; 0.5s &nbsp;|&nbsp; 📼 DVR Playback
        </p>
      </header>

      {/* ── Camera List ────────────────────────────────────── */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Danh Sách Camera</h2>

        {initialCameras.length === 0 ? (
          <div className={styles.emptyState}>
            <span className={styles.emptyIcon}>📡</span>
            <p>Không có camera nào. Kiểm tra kết nối đến Backend.</p>
          </div>
        ) : (
          <div className={styles.cameraGrid}>
            {initialCameras.map((cam) => {
              const isActive = activeCamera?.id === cam.id;
              const isLoading = loadingId === cam.id;
              return (
                <button
                  key={cam.id}
                  className={`${styles.cameraCard} ${isActive ? styles.active : ""} ${isLoading ? styles.loading : ""}`}
                  onClick={() => handleCameraClick(cam)}
                  disabled={isLoading}
                  title={`Mở camera: ${cam.name}`}
                >
                  <span className={styles.cameraIcon}>
                    {isLoading ? "⏳" : isActive ? "🔴" : "📷"}
                  </span>
                  <span className={styles.cameraName}>{cam.name}</span>
                  <span className={styles.cameraId}>{cam.id}</span>
                  {isLoading && (
                    <span className={styles.loadingText}>Đang kết nối...</span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Error Banner ───────────────────────────────────── */}
      {error && (
        <div className={styles.errorBanner} role="alert">
          <span>⚠️ {error}</span>
          <button
            className={styles.dismissBtn}
            onClick={() => setError("")}
            aria-label="Đóng thông báo lỗi"
          >
            ✕
          </button>
        </div>
      )}

      {/* ── Unified Player (live + timeline playback) ──────── */}
      {activeCamera && streamUrl && (
        <section className={styles.playerSection}>
          <CameraPlayer
            key={activeCamera.id}
            cameraId={activeCamera.id}
            cameraName={activeCamera.name}
            streamUrl={streamUrl}
            segments={segments}
            playbackBaseUrl={playbackBaseUrl}
            playbackToken={playbackToken}
            onClose={handleClose}
          />
        </section>
      )}
    </div>
  );
}
