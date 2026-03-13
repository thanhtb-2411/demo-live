import { Body, Controller, Post, Res } from "@nestjs/common";
import { Response } from "express";
import * as jwt from "jsonwebtoken";

/**
 * Payload MediaMTX gửi đến endpoint này khi có kết nối đến bất kỳ path nào.
 * Docs: https://bluenviron.github.io/mediamtx/#external-authentication
 */
interface MediaMTXAuthPayload {
  user?: string;
  password?: string;
  ip?: string;
  /** 'read' = viewer đang kết nối vào xem | 'publish' = nguồn push stream */
  action?: "read" | "publish" | "playback";
  /** Tên path MediaMTX, ví dụ: CTR01 */
  path?: string;
  protocol?: string;
  id?: string;
  /** Query string nguyên bản, ví dụ: "token=eyJ..." */
  query?: string;
}

@Controller("api/auth")
export class AuthController {
  private readonly jwtSecret =
    process.env.JWT_SECRET || "demo-secret-change-in-production";

  /**
   * MediaMTX gọi POST /api/auth/mediamtx mỗi khi có kết nối mới.
   * - Trả về 200 → cho phép
   * - Trả về 4xx → từ chối (MediaMTX sẽ ngắt kết nối)
   */
  @Post("mediamtx")
  validate(@Body() body: MediaMTXAuthPayload, @Res() res: Response): void {
    // Chỉ kiểm tra lúc viewer đọc stream (action = 'read')
    // Các action khác (publish từ source nội bộ) luôn cho qua
    if (body.action !== "read") {
      res.status(200).send("OK");
      return;
    }

    // Lấy token từ query string: ?token=<jwt>
    const params = new URLSearchParams(body.query || "");
    const token = params.get("token");

    if (!token) {
      res.status(401).send("Missing token");
      return;
    }

    try {
      const decoded = jwt.verify(token, this.jwtSecret) as {
        cameraId: string;
      };

      // Đảm bảo token được cấp đúng cho camera này (chống dùng token chéo)
      if (decoded.cameraId !== body.path) {
        res.status(401).send("Token camera mismatch");
        return;
      }

      res.status(200).send("OK");
    } catch {
      // Token hết hạn hoặc sai chữ ký
      res.status(401).send("Invalid or expired token");
    }
  }
}
