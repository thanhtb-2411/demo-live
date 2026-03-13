import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import axios from "axios";
import * as jwt from "jsonwebtoken";
import { CAMERA_CONFIG } from "./cameras.data";

export interface RecordingSegment {
  start: string;        // RFC3339 timestamp
  duration: number;     // seconds
  durationLabel: string; // human-readable, e.g. "1h 23ph"
  label: string;        // formatted start time
  url: string;          // pre-signed playback URL
}

@Injectable()
export class CamerasService {
  private readonly logger = new Logger(CamerasService.name);

  // Đọc cấu hình MediaMTX từ biến môi trường (được set trong docker-compose)
  private readonly mediamtxHost = process.env.MEDIAMTX_HOST || "localhost";
  private readonly mediamtxApiPort = process.env.MEDIAMTX_API_PORT || "9997";
  private readonly mediamtxWebRTCPort =
    process.env.MEDIAMTX_WEBRTC_PORT || "8889";
  private readonly mediamtxPlaybackPort =
    process.env.MEDIAMTX_PLAYBACK_PORT || "9996";
  private readonly jwtSecret =
    process.env.JWT_SECRET || "demo-secret-change-in-production";

  private get apiBaseUrl(): string {
    return `http://${this.mediamtxHost}:${this.mediamtxApiPort}`;
  }

  /**
   * Trả về danh sách camera cho FE – chỉ id, name, mode.
   * Tuyệt đối không trả về IP, username, password hay RTSP URL.
   */
  getCameras() {
    return CAMERA_CONFIG.cameras.map(({ id, name }) => ({
      id,
      name,
    }));
  }

  /**
   * Cốt lõi của hệ thống:
   * 1. Lấy thông tin camera từ mock DB (bao gồm video.source – RTSP URL đầy đủ)
   * 2. Gọi REST API MediaMTX để tạo/cập nhật path On-Demand
   * 3. Trả về WHEP URL để Frontend kết nối WebRTC
   */
  async getLiveStream(id: string): Promise<{ streamUrl: string }> {
    const camera = CAMERA_CONFIG.cameras.find((c) => c.id === id);
    if (!camera) {
      throw new NotFoundException(
        `Camera "${id}" không tồn tại trong hệ thống`,
      );
    }

    // Lấy RTSP URL trực tiếp từ cấu hình (đã chứa credentials)
    const rtspUrl = camera.video.source;

    // Cấu hình path trên MediaMTX (On-Demand + Passthrough)
    await this.configureMediaMTXPath(camera.id, rtspUrl);

    // Sinh JWT token có thời hạn 1 giờ, gắn vào WHEP URL
    // MediaMTX sẽ gọi callback /api/auth/mediamtx để validate token này
    const token = jwt.sign(
      { cameraId: camera.id },
      this.jwtSecret,
      { expiresIn: "1h" },
    );

    const streamUrl = `http://${this.mediamtxHost}:${this.mediamtxWebRTCPort}/${camera.id}/whep?token=${token}`;

    this.logger.log(`[${camera.id}] WHEP URL sẵn sàng: ${streamUrl}`);
    return { streamUrl };
  }

  /**
   * Gọi REST API MediaMTX để đăng ký path (luồng camera).
   * - Nếu path chưa tồn tại → POST /v3/config/paths/add/{id} (tạo mới)
   * - Nếu path đã tồn tại (HTTP 400) → PATCH /v3/config/paths/patch/{id} (cập nhật)
   *
   * Payload theo cơ chế On-Demand:
   *   source           – RTSP URL của camera (có credentials)
   *   sourceOnDemand   – chỉ kết nối camera khi có viewer (tiết kiệm stream slot)
   *   sourceOnDemandCloseAfter – tự ngắt sau N giây không còn viewer
   */
  private async configureMediaMTXPath(
    pathId: string,
    rtspUrl: string,
  ): Promise<void> {
    const payload = {
      source: rtspUrl,
      sourceOnDemand: true,
      // Thời gian chờ nguồn RTSP sẵn sàng (FFmpeg có thể chưa push kịp)
      sourceOnDemandStartTimeout: "30s",
      sourceOnDemandCloseAfter: "10s",
      // Bật ghi hình – file được lưu theo recordPath trong mediamtx.yml
      record: true,
    };

    try {
      await axios.post(
        `${this.apiBaseUrl}/v3/config/paths/add/${pathId}`,
        payload,
      );
      this.logger.log(`[MediaMTX] Path "${pathId}" đã được tạo mới`);
    } catch (error: any) {
      const httpStatus = error?.response?.status;

      if (httpStatus === 400) {
        // Path đã tồn tại → cập nhật RTSP source mới nhất từ DB
        this.logger.log(
          `[MediaMTX] Path "${pathId}" đã tồn tại, đang cập nhật source...`,
        );
        try {
          await axios.patch(
            `${this.apiBaseUrl}/v3/config/paths/patch/${pathId}`,
            payload,
          );
          this.logger.log(`[MediaMTX] Path "${pathId}" đã được cập nhật`);
        } catch (patchErr: any) {
          this.logger.error(
            `[MediaMTX] Lỗi PATCH path "${pathId}": ${patchErr.message}`,
          );
          throw new HttpException(
            `Không thể cập nhật cấu hình MediaMTX: ${patchErr.message}`,
            HttpStatus.INTERNAL_SERVER_ERROR,
          );
        }
      } else {
        // Lỗi khác (MediaMTX chưa khởi động, sai địa chỉ, v.v.)
        this.logger.error(
          `[MediaMTX] Lỗi kết nối API (status ${httpStatus}): ${error.message}`,
        );
        throw new HttpException(
          `Không thể kết nối MediaMTX server: ${error.message}`,
          HttpStatus.BAD_GATEWAY,
        );
      }
    }
  }

  /**
   * Lấy danh sách các đoạn video đã ghi cho camera.
   * Gọi Playback API của MediaMTX: GET :9996/list?path={id}
   * Trả về mảng segment kèm pre-signed URL để FE phát trực tiếp.
   */
  async getRecordings(
    id: string,
  ): Promise<{ recordings: RecordingSegment[]; playbackBaseUrl: string; token: string }> {
    const camera = CAMERA_CONFIG.cameras.find((c) => c.id === id);
    if (!camera) {
      throw new NotFoundException(`Camera "${id}" không tồn tại`);
    }

    const token = jwt.sign(
      { cameraId: id },
      this.jwtSecret,
      { expiresIn: "1h" },
    );

    const playbackBase = `http://${this.mediamtxHost}:${this.mediamtxPlaybackPort}`;

    try {
      const res = await axios.get(`${playbackBase}/list`, {
        params: { path: id, token },
      });

      const raw: { start: string; duration: number }[] = res.data ?? [];

      const recordings: RecordingSegment[] = raw.map((seg) => {
        const startDate = new Date(seg.start);
        const label = startDate.toLocaleString("vi-VN", {
          timeZone: "Asia/Ho_Chi_Minh",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        });

        const totalSec = Math.floor(seg.duration);
        const h = Math.floor(totalSec / 3600);
        const m = Math.floor((totalSec % 3600) / 60);
        const s = totalSec % 60;
        const durationLabel = [
          h ? `${h}h` : "",
          m ? `${m}ph` : "",
          `${s}s`,
        ]
          .filter(Boolean)
          .join(" ");

        const url =
          `${playbackBase}/get?path=${encodeURIComponent(id)}` +
          `&start=${encodeURIComponent(seg.start)}` +
          `&duration=${Math.ceil(seg.duration)}` +
          `&token=${token}`;

        return { start: seg.start, duration: seg.duration, durationLabel, label, url };
      });

      // Sắp xếp mới nhất lên đầu
      recordings.sort(
        (a, b) => new Date(b.start).getTime() - new Date(a.start).getTime(),
      );

      return { recordings, playbackBaseUrl: playbackBase, token };
    } catch (err: any) {
      if (err?.response?.status === 404) {
        return { recordings: [], playbackBaseUrl: playbackBase, token };
      }
      this.logger.error(`[Playback] Lỗi lấy recordings cho "${id}": ${err.message}`);
      throw new HttpException(
        "Không thể lấy danh sách recording",
        HttpStatus.BAD_GATEWAY,
      );
    }
  }
}
