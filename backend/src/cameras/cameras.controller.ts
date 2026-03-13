import { Controller, Get, Param } from "@nestjs/common";
import { CamerasService } from "./cameras.service";

@Controller("api/cameras")
export class CamerasController {
  constructor(private readonly camerasService: CamerasService) {}

  /**
   * GET /api/cameras
   * Trả về danh sách camera cho Frontend – CHỈ id và name,
   * không bao giờ lộ IP, username, password.
   */
  @Get()
  getCameras() {
    return this.camerasService.getCameras();
  }

  /**
   * GET /api/cameras/:id/live
   * Cấu hình luồng camera lên MediaMTX rồi trả về WHEP URL
   * để Frontend kết nối WebRTC trực tiếp.
   */
  @Get(":id/live")
  getLiveStream(@Param("id") id: string) {
    return this.camerasService.getLiveStream(id);
  }

  /**
   * GET /api/cameras/:id/recordings
   * Trả về danh sách các đoạn video đã ghi cho camera.
   * Mỗi segment kèm pre-signed URL để FE phát trực tiếp từ
   * MediaMTX Playback Server (:9996/get?path=...&start=...&duration=...)
   */
  @Get(":id/recordings")
  getRecordings(@Param("id") id: string) {
    return this.camerasService.getRecordings(id);
  }
}
