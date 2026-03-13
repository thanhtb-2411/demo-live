# Live Stream Camera System

Hệ thống xem camera trực tiếp (live) và phát lại (DVR) qua trình duyệt, không cần plugin.

## Tổng quan kiến trúc

```
Camera (RTSP)
     │
     ▼
┌──────────────┐      REST API      ┌─────────────────┐
│   MediaMTX   │ ◄────────────────── │  NestJS Backend │
│ (Media Server│      JWT Auth       │    Port 3001    │
│  Port 8889   │ ─────────────────── │                 │
│  Port 9997   │                     └────────┬────────┘
│  Port 9996   │                              │
│  Port 8554   │                     ┌────────▼────────┐
└──────────────┘                     │  Next.js FE     │
     │                               │    Port 3000    │
     │  WebRTC WHEP                  └─────────────────┘
     ▼
  Browser
```

| Service | Công nghệ | Port |
|---|---|---|
| **MediaMTX** | Media Server (RTSP → WebRTC) | 8554 / 8889 / 9996 / 9997 |
| **Backend** | NestJS | 3001 |
| **Frontend** | Next.js 14 | 3000 |

## Tính năng

- **Live stream** – Xem camera real-time qua WebRTC WHEP, độ trễ < 0.5s
- **DVR Playback** – Phát lại bản ghi, scrub theo timeline
- **On-demand** – MediaMTX chỉ kết nối RTSP khi có người xem
- **Bảo mật** – JWT token 1 giờ, MediaMTX callback về backend để validate
- **Đa camera** – Quản lý nhiều camera từ một giao diện

## Cài đặt & Chạy

### Yêu cầu

- Docker & Docker Compose
- Linux (dùng `network_mode: host` cho WebRTC ICE hoạt động đúng)

### 1. Cấu hình môi trường

```bash
cp .env.example .env
```

Chỉnh sửa `.env`:

```env
# URL RTSP của camera (bao gồm credentials)
DEMO_RTSP=rtsp://user:password@host:port/path

# MediaMTX
MEDIAMTX_HOST=localhost
MEDIAMTX_API_PORT=9997
MEDIAMTX_WEBRTC_PORT=8889
MEDIAMTX_PLAYBACK_PORT=9996

# JWT secret – đổi khi production
JWT_SECRET=change-me-in-production
```

### 2. Khởi động

```bash
docker-compose up --build
```

Sau khi build xong:
- Frontend: http://localhost:3000
- Backend API: http://localhost:3001
- MediaMTX API: http://localhost:9997

### 3. Dừng

```bash
docker-compose down
```

## API Backend

### Cameras

| Method | Endpoint | Mô tả |
|---|---|---|
| `GET` | `/api/cameras` | Danh sách camera (id, name) |
| `GET` | `/api/cameras/:id/live` | Lấy WHEP URL để xem live |
| `GET` | `/api/cameras/:id/recordings` | Danh sách bản ghi DVR |

### Auth (dành cho MediaMTX callback)

| Method | Endpoint | Mô tả |
|---|---|---|
| `POST` | `/api/auth/mediamtx` | Validate JWT token từ MediaMTX |

**Ví dụ `/api/cameras/:id/live`:**
```json
{
  "streamUrl": "http://localhost:8889/CTR01/whep?token=<jwt>"
}
```

**Ví dụ `/api/cameras/:id/recordings`:**
```json
[
  {
    "start": "2026-03-13T08:00:00Z",
    "duration": 3600,
    "durationLabel": "1h 0ph",
    "label": "08:00",
    "url": "http://localhost:9996/CTR01?start=...&token=<jwt>"
  }
]
```

## Cấu trúc thư mục

```
.
├── docker-compose.yml
├── mediamtx.yml          # Cấu hình MediaMTX (auth, recording, ports)
├── .env                  # Biến môi trường (gitignored)
├── .env.example          # Template biến môi trường
├── backend/              # NestJS
│   └── src/
│       ├── main.ts
│       ├── app.module.ts
│       ├── auth/         # JWT validation callback
│       └── cameras/      # Camera registry, live stream, DVR
└── frontend/             # Next.js 14
    └── src/
        ├── app/
        │   └── page.tsx          # Server component fetch camera list
        └── components/
            ├── CameraViewer.tsx  # Grid chọn camera
            ├── CameraPlayer.tsx  # WebRTC player + DVR timeline
            └── PlaybackPlayer.tsx # DVR video player
```

## Luồng hoạt động

### Xem Live

```
Browser → GET /api/cameras/:id/live
         Backend cấu hình path trên MediaMTX (RTSP source)
         Backend sinh JWT (1h)
         ← trả về WHEP URL + token
Browser → WebRTC WHEP handshake với MediaMTX
          MediaMTX → POST /api/auth/mediamtx (validate token)
          ← 200 OK
MediaMTX kéo RTSP từ camera → đẩy về Browser qua WebRTC
```

### Xem DVR

```
Browser → GET /api/cameras/:id/recordings
         Backend gọi MediaMTX Playback API
         ← danh sách segment với pre-signed URL
Browser → chọn segment → phát fmp4 từ MediaMTX Playback Server
          mỗi request đều validate JWT qua callback
```

## Thêm camera thực

Chỉnh sửa [backend/src/cameras/cameras.data.ts](backend/src/cameras/cameras.data.ts):

```typescript
export const CAMERA_CONFIG: CameraConfig = {
  cameras: [
    {
      id: "CAM01",
      name: "Camera Cổng Chính",
      video: {
        source: "rtsp://user:pass@192.168.1.100:554/stream1",
        options: { hwaccel: "auto", rtsp_transport: "tcp" },
      },
    },
    // Thêm camera...
  ],
};
```

Hoặc tích hợp database (TypeORM / Prisma) thay thế mock data.

## Môi trường Development (không dùng Docker)

### Backend

```bash
cd backend
npm install
npm run start:dev   # hot-reload, port 3001
```

### Frontend

```bash
cd frontend
npm install
npm run dev         # hot-reload, port 3000
```

> MediaMTX vẫn cần chạy riêng (Docker hoặc binary).
