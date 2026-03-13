"use client";

import { useRef, useState } from "react";
import styles from "./PlaybackPlayer.module.css";

export interface RecordingSegment {
  start: string;
  duration: number;
  durationLabel: string;
  label: string;
  url: string;
}

interface PlaybackPlayerProps {
  cameraName: string;
  segments: RecordingSegment[];
  onClose: () => void;
}

export default function PlaybackPlayer({
  cameraName,
  segments,
  onClose,
}: PlaybackPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [activeIdx, setActiveIdx] = useState<number | null>(null);

  const handleSelect = (idx: number) => {
    setActiveIdx(idx);
    // Reset video element để load URL mới
    if (videoRef.current) {
      videoRef.current.load();
    }
  };

  const activeSegment = activeIdx !== null ? segments[activeIdx] : null;

  return (
    <div className={styles.container}>
      {/* ── Header ─────────────────────────────────────────── */}
      <div className={styles.header}>
        <div className={styles.info}>
          <span className={styles.icon}>📼</span>
          <span className={styles.name}>{cameraName}</span>
          <span className={styles.badge}>Xem lại</span>
        </div>
        <button className={styles.closeBtn} onClick={onClose}>
          ✕ Đóng
        </button>
      </div>

      <div className={styles.body}>
        {/* ── Danh sách segment ──────────────────────────────── */}
        <aside className={styles.sidebar}>
          <p className={styles.sidebarTitle}>📁 {segments.length} đoạn ghi</p>
          {segments.length === 0 ? (
            <div className={styles.empty}>
              <span>🎞️</span>
              <p>Chưa có video nào được ghi.</p>
              <p className={styles.hint}>
                Video sẽ xuất hiện sau khi camera được xem live lần đầu.
              </p>
            </div>
          ) : (
            <ul className={styles.segmentList}>
              {segments.map((seg, idx) => (
                <li key={seg.start}>
                  <button
                    className={`${styles.segmentItem} ${activeIdx === idx ? styles.activeSegment : ""}`}
                    onClick={() => handleSelect(idx)}
                  >
                    <span className={styles.segmentTime}>{seg.label}</span>
                    <span className={styles.segmentDuration}>
                      ⏱ {seg.durationLabel}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        {/* ── Video player ───────────────────────────────────── */}
        <div className={styles.playerArea}>
          {activeSegment ? (
            <>
              <video
                ref={videoRef}
                key={activeSegment.url}
                src={activeSegment.url}
                controls
                autoPlay
                playsInline
                className={styles.video}
              />
              <p className={styles.segmentInfo}>
                🕐 {activeSegment.label} &nbsp;·&nbsp; ⏱{" "}
                {activeSegment.durationLabel}
              </p>
            </>
          ) : (
            <div className={styles.placeholder}>
              <span className={styles.placeholderIcon}>▶️</span>
              <p>Chọn một đoạn ghi bên trái để phát</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
