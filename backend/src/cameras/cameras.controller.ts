import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import { CamerasService } from "./cameras.service";

@Controller("api/cameras")
export class CamerasController {
  constructor(private readonly camerasService: CamerasService) {}

  /** GET /api/cameras – danh sách camera (chỉ id + name) */
  @Get()
  getCameras() {
    return this.camerasService.getCameras();
  }

  /** POST /api/cameras – thêm camera mới */
  @Post()
  createCamera(@Body() body: { name: string; source: string }) {
    return this.camerasService.createCamera(body.name, body.source);
  }

  /** GET /api/cameras/:id/live – HLS URL cho live stream */
  @Get(":id/live")
  getLiveStream(@Param("id") id: string) {
    return this.camerasService.getLiveStream(id);
  }

  /** GET /api/cameras/:id – chi tiết camera (kèm source để edit) */
  @Get(":id")
  getCamera(@Param("id") id: string) {
    return this.camerasService.getCamera(id);
  }

  /** PATCH /api/cameras/:id – cập nhật camera */
  @Patch(":id")
  updateCamera(
    @Param("id") id: string,
    @Body() body: { name: string; source: string },
  ) {
    return this.camerasService.updateCamera(id, body.name, body.source);
  }

  /** DELETE /api/cameras/:id – xóa camera */
  @Delete(":id")
  @HttpCode(204)
  deleteCamera(@Param("id") id: string) {
    return this.camerasService.deleteCamera(id);
  }
}
