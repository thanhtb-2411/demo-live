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

### Sơ đồ tổng quan (Sequence Diagram)

```mermaid
sequenceDiagram
    autonumber
    participant Browser
    participant NextJS as Next.js :3000
    participant Backend as NestJS Backend :3001
    participant MediaMTX as MediaMTX :8889/9997
    participant Camera as Camera (RTSP)

    %% ─── 1. Tải trang ─────────────────────────────────────
    rect rgb(30, 40, 60)
        note over Browser,Backend: 1. Tải trang
        Browser->>NextJS: GET /
        NextJS-->>Browser: HTML + CameraViewer component
        Browser->>NextJS: GET /api/cameras
        NextJS->>Backend: proxy → GET /api/cameras
        Backend-->>NextJS: [{id, name}, ...]
        NextJS-->>Browser: danh sách camera (chỉ id + name,<br/>không lộ RTSP URL)
    end

    %% ─── 2. Mở live stream ─────────────────────────────────
    rect rgb(30, 50, 40)
        note over Browser,MediaMTX: 2. Mở live stream (click camera)
        Browser->>NextJS: GET /api/cameras/:id/live
        NextJS->>Backend: proxy → GET /api/cameras/:id/live
        Backend->>Backend: cameraStore.findById(id)<br/>lấy RTSP URL
        Backend->>MediaMTX: POST /v3/config/paths/add/:id<br/>{source: rtsp://, sourceOnDemand: true}
        alt path đã tồn tại (HTTP 400)
            MediaMTX-->>Backend: 400 Bad Request
            Backend->>MediaMTX: PATCH /v3/config/paths/patch/:id
            MediaMTX-->>Backend: 200 OK
        else path mới
            MediaMTX-->>Backend: 200 OK
        end
        Backend->>Backend: jwt.sign({cameraId}, secret, 24h)
        Backend-->>NextJS: {streamUrl: .../whep?token=JWT,<br/>hlsUrl, token, dvrWindowSeconds}
        NextJS-->>Browser: trả về WHEP URL + token
    end

    %% ─── 3. WebRTC WHEP handshake ──────────────────────────
    rect rgb(50, 30, 40)
        note over Browser,Camera: 3. Kết nối WebRTC (WHEP)
        Browser->>Browser: new RTCPeerConnection()<br/>addTransceiver video+audio (recvonly)
        Browser->>Browser: createOffer() → setLocalDescription()<br/>chờ ICE gathering xong
        Browser->>MediaMTX: POST :8889/:id/whep?token=JWT<br/>Content-Type: application/sdp<br/>Authorization: Basic viewer:viewer123<br/>Body: SDP offer
        MediaMTX->>Camera: kéo RTSP on-demand<br/>(vì sourceOnDemand: true)
        Camera-->>MediaMTX: RTSP stream
        MediaMTX-->>Browser: 200 OK + SDP answer
        Browser->>Browser: setRemoteDescription(answer)<br/>ICE negotiation (UDP :8189)
        Browser->>Browser: ontrack → srcObject = stream<br/>⇒ video phát, độ trễ < 0.5s
    end

    %% ─── 4. DVR in-memory ──────────────────────────────────
    rect rgb(40, 40, 20)
        note over Browser: 4. DVR in-memory (sau khi stream chạy)
        Browser->>Browser: MediaRecorder.start(1000ms)<br/>ghi stream vào chunksRef[]<br/>giữ tối đa dvrWindowSeconds chunk
        note over Browser: Người dùng kéo thanh timeline
        Browser->>Browser: snapshot chunks → new Blob([initChunk, ...chunks])<br/>URL.createObjectURL(blob)
        Browser->>Browser: dvrVideoRef.src = blobURL<br/>seek đến vị trí tương ứng<br/>⇒ phát lại từ RAM, không cần server
        note over Browser: Nhấn "Về LIVE"
        Browser->>Browser: dvrVideo.src = "" · revoke blobURL<br/>mode = "live" · liveVideoRef tiếp tục chạy
    end

    %% ─── 5. Auth callback (đang disabled) ──────────────────
    rect rgb(50, 30, 20)
        note over MediaMTX,Backend: 5. Auth callback (đã code, hiện bị comment trong mediamtx.yml)
        MediaMTX-->>Backend: POST /api/auth/mediamtx<br/>{action:"read", path:"CTR01", query:"token=JWT"}
        alt action != "read"
            Backend-->>MediaMTX: 200 OK (publish nội bộ luôn cho qua)
        else action == "read"
            Backend->>Backend: jwt.verify(token, secret)<br/>kiểm tra decoded.cameraId == path
            alt token hợp lệ + cameraId khớp
                Backend-->>MediaMTX: 200 OK
            else token sai / hết hạn / cameraId không khớp
                Backend-->>MediaMTX: 401 Unauthorized
                MediaMTX-->>Browser: ngắt kết nối
            end
        end
    end
```

### Chi tiết: Luồng request Live Camera

```mermaid
sequenceDiagram
    autonumber
    participant Browser
    participant NextJS as Next.js :3000
    participant Backend as NestJS :3001
    participant MediaMTX as MediaMTX :9997 (API)
    participant WHEP as MediaMTX :8889 (WHEP)
    participant Camera as Camera (RTSP)

    Browser->>NextJS: click camera → GET /api/cameras/:id/live

    rect rgb(20, 40, 70)
        note over NextJS,Backend: Next.js rewrite proxy (next.config.mjs)
        NextJS->>Backend: GET /api/cameras/:id/live
    end

    rect rgb(20, 55, 35)
        note over Backend: cameras.service.ts – getLiveStream()
        Backend->>Backend: cameraStore.findById(id)
        alt Camera không tồn tại
            Backend-->>NextJS: 404 NotFoundException
            NextJS-->>Browser: 404 – Camera không tồn tại
        end
        Backend->>Backend: rtspUrl = camera.video.source
    end

    rect rgb(55, 35, 20)
        note over Backend,MediaMTX: cameras.service.ts – configureMediaMTXPath()
        Backend->>MediaMTX: POST /v3/config/paths/add/:id<br/>{ source: rtspUrl,<br/>  sourceOnDemand: true,<br/>  sourceOnDemandStartTimeout: "30s",<br/>  sourceOnDemandCloseAfter: "10s" }<br/>Authorization: Basic admin:admin123
        alt Path chưa tồn tại
            MediaMTX-->>Backend: 200 OK ✅ Path created
        else Path đã tồn tại (HTTP 400)
            MediaMTX-->>Backend: 400 Bad Request
            Backend->>MediaMTX: PATCH /v3/config/paths/patch/:id<br/>{ source: rtspUrl, sourceOnDemand: true, ... }
            MediaMTX-->>Backend: 200 OK ✅ Path updated
        else MediaMTX chưa khởi động / lỗi mạng
            MediaMTX-->>Backend: network error / 5xx
            Backend-->>NextJS: 502 Bad Gateway
            NextJS-->>Browser: "Không thể kết nối MediaMTX server"
        end
    end

    rect rgb(20, 40, 70)
        note over Backend: cameras.service.ts – ký JWT
        Backend->>Backend: jwt.sign({ cameraId: id }, JWT_SECRET, { expiresIn: "24h" })
        Backend->>Backend: streamUrl = http://mediamtxHost:8889/:id/whep?token=JWT
        Backend->>Backend: hlsUrl   = http://mediamtxHost:8888/:id/index.m3u8
        Backend-->>NextJS: 200 OK<br/>{ streamUrl, hlsUrl, token, dvrWindowSeconds }
        NextJS-->>Browser: 200 OK<br/>{ streamUrl, hlsUrl, token, dvrWindowSeconds }
    end

    rect rgb(55, 20, 55)
        note over Browser: CameraViewer.tsx – handleCameraClick()
        Browser->>Browser: setStreamUrl(data.streamUrl)<br/>setDvrWindowSeconds(data.dvrWindowSeconds)<br/>setActiveCamera(camera)
        Browser->>Browser: mount &lt;CameraPlayer streamUrl=WHEP_URL /&gt;
    end

    rect rgb(20, 55, 55)
        note over Browser,Camera: CameraPlayer.tsx – connectWhep()
        Browser->>Browser: new RTCPeerConnection({ iceServers: STUN })<br/>addTransceiver("video", recvonly)<br/>addTransceiver("audio", recvonly)
        Browser->>Browser: createOffer() → setLocalDescription()<br/>chờ iceGatheringState == "complete" (max 5s)
        Browser->>WHEP: POST :8889/:id/whep?token=JWT<br/>Content-Type: application/sdp<br/>Authorization: Basic viewer:viewer123<br/>Body: SDP Offer
        WHEP->>Camera: kéo RTSP on-demand<br/>(sourceOnDemand: true → connect lần đầu)
        Camera-->>WHEP: RTSP stream (H.264/AAC)
        WHEP-->>Browser: 200 OK + SDP Answer
        Browser->>Browser: setRemoteDescription(answer)
        Browser->>WHEP: ICE candidates (UDP :8189)
        WHEP-->>Browser: ICE candidates
        note over Browser,WHEP: ICE Connected ✅
        Browser->>Browser: ontrack fired<br/>liveVideoRef.srcObject = MediaStream<br/>setLiveStatus("playing")
        Browser->>Browser: MediaRecorder.start(1000ms)<br/>bắt đầu ghi DVR in-memory
        note over Browser: 🔴 LIVE – độ trễ < 0.5s
    end

    rect rgb(55, 55, 20)
        note over Browser,WHEP: Auto-reconnect (CameraPlayer)
        loop Mỗi 20s kiểm tra frozen stream
            Browser->>Browser: so sánh video.currentTime<br/>nếu không đổi → scheduleReconnect
        end
        alt ICE disconnected (mạng chập chờn)
            WHEP-->>Browser: ICE state = "disconnected"
            Browser->>Browser: scheduleReconnect(5s)
        else ICE failed (đứt hẳn)
            WHEP-->>Browser: ICE state = "failed"
            Browser->>Browser: scheduleReconnect(1s)
            Browser->>WHEP: POST SDP Offer (kết nối lại)
        end
    end
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
