import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import axios from "axios";
import * as jwt from "jsonwebtoken";
import { cameraStore } from "./cameras.data";

@Injectable()
export class CamerasService {
  private readonly logger = new Logger(CamerasService.name);

  // Đọc cấu hình MediaMTX từ biến môi trường (được set trong docker-compose)
  private readonly mediamtxHost = process.env.MEDIAMTX_HOST || "localhost";
  private readonly mediamtxApiPort = process.env.MEDIAMTX_API_PORT || "9997";
  private readonly mediamtxHlsPort = process.env.MEDIAMTX_HLS_PORT || "8888";
  private readonly mediamtxApiUser = process.env.MEDIAMTX_API_USER || "admin";
  private readonly mediamtxApiPass =
    process.env.MEDIAMTX_API_PASS || "admin123";
  private readonly dvrWindowSeconds = parseInt(
    process.env.DVR_WINDOW_SECONDS || "300",
    10,
  );
  private readonly jwtSecret =
    process.env.JWT_SECRET || "demo-secret-change-in-production";

  private get apiAuth() {
    return { username: this.mediamtxApiUser, password: this.mediamtxApiPass };
  }

  private get apiBaseUrl(): string {
    return `http://${this.mediamtxHost}:${this.mediamtxApiPort}`;
  }

  /**
   * Trả về danh sách camera cho FE – chỉ id, name, mode.
   * Tuyệt đối không trả về IP, username, password hay RTSP URL.
   */
  getCameras() {
    return cameraStore.getAll().map(({ id, name }) => ({ id, name }));
  }

  /**
   * Cốt lõi của hệ thống:
   * 1. Lấy thông tin camera từ mock DB (bao gồm video.source – RTSP URL đầy đủ)
   * 2. Gọi REST API MediaMTX để tạo/cập nhật path (source on-demand)
   * 3. Trả về HLS URL + token
   */
  async getLiveStream(id: string): Promise<{
    streamUrl: string;
    token: string;
    dvrWindowSeconds: number;
  }> {
    const camera = cameraStore.findById(id);
    if (!camera) {
      throw new NotFoundException(
        `Camera "${id}" không tồn tại trong hệ thống`,
      );
    }

    // Lấy RTSP URL trực tiếp từ cấu hình (đã chứa credentials)
    const rtspUrl = camera.video.source;

    // Cấu hình path trên MediaMTX (On-Demand + Passthrough)
    await this.configureMediaMTXPath(camera.id, rtspUrl);

    // Sinh JWT token có thời hạn 24 giờ
    const token = jwt.sign({ cameraId: camera.id }, this.jwtSecret, {
      expiresIn: "24h",
    });

    // HLS URL – trình duyệt dùng hls.js để phát live và seek trong DVR window
    const streamUrl = `http://${this.mediamtxHost}:${this.mediamtxHlsPort}/${camera.id}/index.m3u8`;

    this.logger.log(`[${camera.id}] HLS URL: ${streamUrl}`);
    this.logger.log(`[${camera.id}] DVR window: ${this.dvrWindowSeconds}s`);

    return {
      streamUrl,
      token,
      dvrWindowSeconds: this.dvrWindowSeconds,
    };
  }

  /**
   * Gọi REST API MediaMTX để đăng ký path (luồng camera).
   * - Nếu path chưa tồn tại → POST /v3/config/paths/add/{id} (tạo mới)
   * - Nếu path đã tồn tại (HTTP 400) → PATCH /v3/config/paths/patch/{id} (cập nhật)
   *
   * Dùng source passthrough (on-demand):
   * MediaMTX tự pull RTSP từ camera khi có viewer đầu tiên kết nối,
   * tự động tắt sau khi không còn viewer.
   */
  private async configureMediaMTXPath(
    pathId: string,
    rtspUrl: string,
  ): Promise<void> {
    const payload = {
      source: rtspUrl,
      sourceOnDemand: true,
      // Xoá config cũ (runOnDemand từ WebRTC) nếu path đã tồn tại trước đó
      runOnDemand: "",
      runOnUnDemand: "",
    };

    const getUrl = `${this.apiBaseUrl}/v3/config/paths/get/${pathId}`;
    const addUrl = `${this.apiBaseUrl}/v3/config/paths/add/${pathId}`;
    const patchUrl = `${this.apiBaseUrl}/v3/config/paths/patch/${pathId}`;

    // 1. Check path exists
    let exists = false;
    try {
      const getRes = await axios.get(getUrl, { auth: this.apiAuth });
      this.logger.log(
        `[MediaMTX] GET ${getUrl} → ${getRes.status} (path tồn tại)`,
      );
      exists = true;
    } catch (getErr: any) {
      const getStatus = getErr?.response?.status;
      this.logger.log(
        `[MediaMTX] GET ${getUrl} → ${getStatus} (path chưa tồn tại)`,
      );
      if (getStatus !== 404) {
        const getBody = JSON.stringify(getErr?.response?.data ?? {});
        throw new HttpException(
          `MediaMTX GET thất bại (${getStatus}): ${getBody}`,
          HttpStatus.BAD_GATEWAY,
        );
      }
    }

    // 2. PATCH or POST based on existence
    if (exists) {
      this.logger.log(
        `[MediaMTX] PATCH ${patchUrl} payload=${JSON.stringify(payload)}`,
      );
      try {
        const patchRes = await axios.patch(patchUrl, payload, {
          auth: this.apiAuth,
        });
        this.logger.log(
          `[MediaMTX] PATCH ${patchUrl} → ${patchRes.status} (đã cập nhật)`,
        );
      } catch (patchErr: any) {
        const patchStatus = patchErr?.response?.status;
        const patchBody = JSON.stringify(patchErr?.response?.data ?? {});
        this.logger.error(
          `[MediaMTX] PATCH ${patchUrl} → ${patchStatus} body=${patchBody}`,
        );
        throw new HttpException(
          `MediaMTX PATCH thất bại (${patchStatus}): ${patchBody}`,
          HttpStatus.BAD_GATEWAY,
        );
      }
    } else {
      this.logger.log(
        `[MediaMTX] POST ${addUrl} payload=${JSON.stringify(payload)}`,
      );
      try {
        const addRes = await axios.post(addUrl, payload, {
          auth: this.apiAuth,
        });
        this.logger.log(
          `[MediaMTX] POST ${addUrl} → ${addRes.status} (đã tạo mới)`,
        );
      } catch (addErr: any) {
        const addStatus = addErr?.response?.status;
        const addBody = JSON.stringify(addErr?.response?.data ?? {});
        this.logger.error(
          `[MediaMTX] POST ${addUrl} → ${addStatus} body=${addBody}`,
        );
        throw new HttpException(
          `MediaMTX POST thất bại (${addStatus}): ${addBody}`,
          HttpStatus.BAD_GATEWAY,
        );
      }
    }
  }

  /** Trả về thông tin camera kèm source (dùng cho form chỉnh sửa) */
  getCamera(id: string) {
    const camera = cameraStore.findById(id);
    if (!camera) throw new NotFoundException(`Camera "${id}" không tồn tại`);
    return { id: camera.id, name: camera.name, source: camera.video.source };
  }

  /** Tạo camera mới */
  createCamera(name: string, source: string) {
    if (!name?.trim())
      throw new HttpException("Thiếu tên camera", HttpStatus.BAD_REQUEST);
    if (!source?.trim())
      throw new HttpException("Thiếu địa chỉ RTSP", HttpStatus.BAD_REQUEST);
    return cameraStore.create(name, source);
  }

  /** Cập nhật camera */
  updateCamera(id: string, name: string, source: string) {
    if (!name?.trim())
      throw new HttpException("Thiếu tên camera", HttpStatus.BAD_REQUEST);
    if (!source?.trim())
      throw new HttpException("Thiếu địa chỉ RTSP", HttpStatus.BAD_REQUEST);
    const updated = cameraStore.update(id, name, source);
    if (!updated) throw new NotFoundException(`Camera "${id}" không tồn tại`);
    return updated;
  }

  /** Xóa camera */
  deleteCamera(id: string) {
    const ok = cameraStore.remove(id);
    if (!ok) throw new NotFoundException(`Camera "${id}" không tồn tại`);
  }
}
