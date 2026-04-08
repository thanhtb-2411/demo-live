"use client";

import { useCallback, useEffect, useState } from "react";
import CameraPlayer from "./CameraPlayer";
import styles from "./CameraViewer.module.css";

interface Camera {
  id: string;
  name: string;
}

type ModalState = null | { mode: "add" } | { mode: "edit"; camera: Camera };

export default function CameraViewer() {
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [activeCamera, setActiveCamera] = useState<Camera | null>(null);
  const [streamUrl, setStreamUrl] = useState<string>("");
  const [manualWhepUrl, setManualWhepUrl] = useState<string>("");
  const [dvrWindowSeconds, setDvrWindowSeconds] = useState<number>(300);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string>("");

  // Modal state
  const [modal, setModal] = useState<ModalState>(null);
  const [formName, setFormName] = useState("");
  const [formSource, setFormSource] = useState("");
  const [formError, setFormError] = useState("");
  const [formLoading, setFormLoading] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const fetchCameras = useCallback(async () => {
    try {
      const res = await fetch("/api/cameras");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setCameras(await res.json());
    } catch {
      setError("Không thể tải danh sách camera");
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    fetchCameras();
  }, [fetchCameras]);

  const handleCameraClick = useCallback(async (camera: Camera) => {
    setLoadingId(camera.id);
    setError("");
    setActiveCamera(null);
    setStreamUrl("");
    try {
      const res = await fetch(`/api/cameras/${camera.id}/live`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setStreamUrl(data.streamUrl);
      setDvrWindowSeconds(data.dvrWindowSeconds ?? 300);
      setActiveCamera(camera);
    } catch (err: unknown) {
      setError(
        `Không thể kết nối "${camera.name}": ${err instanceof Error ? err.message : "Lỗi không xác định"}`,
      );
    } finally {
      setLoadingId(null);
    }
  }, []);

  const handleClose = useCallback(() => {
    setActiveCamera(null);
    setStreamUrl("");
    setError("");
  }, []);

  const handleManualWhepPlay = useCallback(() => {
    const url = manualWhepUrl.trim();
    if (!url) {
      setError("Vui lòng nhập WHEP URL");
      return;
    }

    if (!/^https?:\/\//i.test(url)) {
      setError("WHEP URL phải bắt đầu bằng http:// hoặc https://");
      return;
    }

    setError("");
    setLoadingId(null);
    setDvrWindowSeconds(300);
    setStreamUrl(url);
    setActiveCamera({
      id: "manual-whep",
      name: "Live từ WHEP URL",
    });
  }, [manualWhepUrl]);

  const openAddModal = () => {
    setFormName("");
    setFormSource("");
    setFormError("");
    setModal({ mode: "add" });
  };

  const openEditModal = async (cam: Camera) => {
    setFormName(cam.name);
    setFormSource("");
    setFormError("");
    setModal({ mode: "edit", camera: cam });
    try {
      const res = await fetch(`/api/cameras/${cam.id}`);
      if (res.ok) {
        const data = await res.json();
        setFormSource(data.source ?? "");
      }
    } catch {
      /* giữ form rỗng nếu fetch lỗi */
    }
  };

  const handleSave = async () => {
    if (!formName.trim()) {
      setFormError("Tên camera không được để trống");
      return;
    }
    if (!formSource.trim()) {
      setFormError("Địa chỉ RTSP không được để trống");
      return;
    }
    setFormLoading(true);
    setFormError("");
    try {
      if (modal?.mode === "add") {
        const res = await fetch("/api/cameras", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: formName.trim(),
            source: formSource.trim(),
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } else if (modal?.mode === "edit") {
        const res = await fetch(`/api/cameras/${modal.camera.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: formName.trim(),
            source: formSource.trim(),
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      }
      setModal(null);
      await fetchCameras();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "Lỗi lưu dữ liệu");
    } finally {
      setFormLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/cameras/${id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 204) throw new Error(`HTTP ${res.status}`);
      if (activeCamera?.id === id) handleClose();
      await fetchCameras();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Lỗi xóa camera");
    } finally {
      setConfirmDeleteId(null);
    }
  };

  return (
    <div className={styles.container}>
      {/* Header */}
      <header className={styles.header}>
        <h1 className={styles.title}>🎥 Hệ Thống Camera Live Stream</h1>
        <p className={styles.subtitle}>
          WebRTC (WHEP) + In-Memory DVR &nbsp;|&nbsp; MediaMTX &nbsp;|&nbsp; Độ
          trễ &lt; 0.5s
        </p>
      </header>

      {/* Camera list */}
      <section className={styles.section}>
        <div className={styles.quickWhepBox}>
          <h2 className={styles.sectionTitle}>Xem Nhanh Bằng WHEP URL</h2>
          <div className={styles.quickWhepRow}>
            <input
              className={styles.quickWhepInput}
              type="text"
              placeholder="http://35.213.124.167:8889/your-stream-id/whep"
              value={manualWhepUrl}
              onChange={(e) => setManualWhepUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handleManualWhepPlay();
                }
              }}
            />
            <button
              className={styles.quickWhepBtn}
              onClick={handleManualWhepPlay}
            >
              Xem Live
            </button>
          </div>
        </div>

        <div className={styles.mgmtRow}>
          <h2 className={styles.sectionTitle}>Danh Sách Camera</h2>
          <button className={styles.addBtn} onClick={openAddModal}>
            + Thêm Camera
          </button>
        </div>

        {loadingList ? (
          <div className={styles.emptyState}>
            <span className={styles.emptyIcon}>⏳</span>
            <p>Đang tải danh sách camera...</p>
          </div>
        ) : cameras.length === 0 ? (
          <div className={styles.emptyState}>
            <span className={styles.emptyIcon}>📡</span>
            <p>
              Chưa có camera nào. Nhấn &quot;+ Thêm Camera&quot; để bắt đầu.
            </p>
          </div>
        ) : (
          <div className={styles.cameraGrid}>
            {cameras.map((cam) => {
              const isActive = activeCamera?.id === cam.id;
              const isLoading = loadingId === cam.id;
              return (
                <div
                  key={cam.id}
                  className={`${styles.cameraCard} ${isActive ? styles.active : ""} ${isLoading ? styles.loading : ""}`}
                >
                  <button
                    className={styles.cardMain}
                    onClick={() => handleCameraClick(cam)}
                    disabled={isLoading}
                    title={`Xem live: ${cam.name}`}
                  >
                    <span className={styles.cameraIcon}>
                      {isLoading ? "⏳" : isActive ? "🔴" : "📷"}
                    </span>
                    <span className={styles.cameraName}>{cam.name}</span>
                    <span className={styles.cameraId}>{cam.id}</span>
                    {isLoading && (
                      <span className={styles.loadingText}>
                        Đang kết nối...
                      </span>
                    )}
                  </button>
                  <div className={styles.cardActions}>
                    <button
                      className={styles.editBtn}
                      onClick={() => openEditModal(cam)}
                      title="Chỉnh sửa"
                    >
                      ✏️ Sửa
                    </button>
                    <button
                      className={styles.deleteBtn}
                      onClick={() => setConfirmDeleteId(cam.id)}
                      title="Xóa camera"
                    >
                      🗑️ Xóa
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Error Banner */}
      {error && (
        <div className={styles.errorBanner} role="alert">
          <span>⚠️ {error}</span>
          <button
            className={styles.dismissBtn}
            onClick={() => setError("")}
            aria-label="Đóng"
          >
            ✕
          </button>
        </div>
      )}

      {/* Player */}
      {activeCamera && streamUrl && (
        <section className={styles.playerSection}>
          <CameraPlayer
            key={activeCamera.id}
            cameraId={activeCamera.id}
            cameraName={activeCamera.name}
            streamUrl={streamUrl}
            dvrWindowSeconds={dvrWindowSeconds}
            onClose={handleClose}
          />
        </section>
      )}

      {/* Add / Edit Modal */}
      {modal && (
        <div
          className={styles.modalOverlay}
          onClick={() => !formLoading && setModal(null)}
        >
          <div
            className={styles.modalContent}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className={styles.modalTitle}>
              {modal.mode === "add"
                ? "Thêm Camera Mới"
                : `Chỉnh Sửa: ${modal.mode === "edit" ? modal.camera.name : ""}`}
            </h3>

            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Tên Camera</label>
              <input
                className={styles.formInput}
                type="text"
                placeholder="Vd: Camera Cổng Vào"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                disabled={formLoading}
                autoFocus
              />
            </div>

            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Địa Chỉ RTSP (Source)</label>
              <input
                className={styles.formInput}
                type="text"
                placeholder="rtsp://user:pass@host:port/path"
                value={formSource}
                onChange={(e) => setFormSource(e.target.value)}
                disabled={formLoading}
              />
            </div>

            {formError && <p className={styles.formError}>⚠️ {formError}</p>}

            <div className={styles.modalActions}>
              <button
                className={styles.cancelBtn}
                onClick={() => setModal(null)}
                disabled={formLoading}
              >
                Hủy
              </button>
              <button
                className={styles.saveBtn}
                onClick={handleSave}
                disabled={formLoading}
              >
                {formLoading ? "Đang lưu..." : "Lưu"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Delete */}
      {confirmDeleteId && (
        <div
          className={styles.modalOverlay}
          onClick={() => setConfirmDeleteId(null)}
        >
          <div
            className={styles.modalContent}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className={styles.modalTitle}>Xác Nhận Xóa</h3>
            <p className={styles.confirmText}>
              Bạn có chắc muốn xóa camera{" "}
              <strong>
                {cameras.find((c) => c.id === confirmDeleteId)?.name ??
                  confirmDeleteId}
              </strong>{" "}
              không? Hành động này không thể hoàn tác.
            </p>
            <div className={styles.modalActions}>
              <button
                className={styles.cancelBtn}
                onClick={() => setConfirmDeleteId(null)}
              >
                Hủy
              </button>
              <button
                className={styles.deleteConfirmBtn}
                onClick={() => handleDelete(confirmDeleteId)}
              >
                Xóa
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
