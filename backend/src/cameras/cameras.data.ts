// ─── Interfaces (khớp với format JSON thực tế của hệ thống) ───────────────────

export interface NVR {
  ip: string;
  username: string;
  password: string;
}

export interface VideoConfig {
  /** RTSP URL đầy đủ kèm credentials, ví dụ: rtsp://user:pass@host/path */
  source: string;
  options: {
    hwaccel?: string;
    rtsp_transport?: string;
  };
}

export interface Camera {
  id: string;
  /** Tên hiển thị trên UI – không có trong JSON gốc, thêm vào để FE dùng */
  name: string;
  video: VideoConfig;
}

export interface CameraConfig {
  cameras: Camera[];
}

// ─── Mock Data ─────────────────────────────────────────────────────────────────
// Trong thực tế thay bằng ORM (TypeORM / Prisma) đọc từ DB.
// Source RTSP demo trỏ vào luồng demo_feed được FFmpeg push lên MediaMTX
// bằng cách lặp vô hạn file video.MOV (xem service `rtsp-demo` trong docker-compose).
// Thay bằng RTSP URL thực của camera khi triển khai production.

// FAKE: lấy luồng từ FFmpeg loop video.MOV qua MediaMTX (chỉ dùng khi chưa có camera thực)
const DEMO_RTSP = "rtsp://admin:8TuwdmlF@155.248.185.149:27720/1/2";

export const CAMERA_CONFIG: CameraConfig = {
  cameras: [
    {
      id: "CTR01",
      name: "Camera Cổng Vào",
      video: {
        source: DEMO_RTSP,
        options: { hwaccel: "auto", rtsp_transport: "tcp" },
      },
    },
    {
      id: "CTR02",
      name: "Camera Cổng Ra",
      video: {
        source: DEMO_RTSP,
        options: { hwaccel: "auto", rtsp_transport: "tcp" },
      },
    },
    {
      id: "CTR03",
      name: "Camera Hành Lang A",
      video: {
        source: DEMO_RTSP,
        options: { hwaccel: "auto", rtsp_transport: "tcp" },
      },
    },
    {
      id: "CTR04",
      name: "Camera Khu Kho",
      video: {
        source: DEMO_RTSP,
        options: { hwaccel: "auto", rtsp_transport: "tcp" },
      },
    },
  ],
};
