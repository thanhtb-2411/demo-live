import { randomUUID } from "crypto";

export interface VideoConfig {
  /** RTSP URL đầy đủ kèm credentials */
  source: string;
  options: { hwaccel?: string; rtsp_transport?: string };
}

export interface Camera {
  id: string;
  name: string;
  video: VideoConfig;
}

/**
 * In-memory camera store – singleton, sống suốt vòng đời process.
 * Thay bằng TypeORM/Prisma khi có DB thực.
 */
class CameraStore {
  private readonly map = new Map<string, Camera>();

  constructor(initial: Camera[]) {
    initial.forEach((c) => this.map.set(c.id, c));
  }

  getAll(): Camera[] {
    return Array.from(this.map.values());
  }

  findById(id: string): Camera | undefined {
    return this.map.get(id);
  }

  create(name: string, source: string): Camera {
    const id = `CAM${randomUUID().split("-")[0].toUpperCase()}`;
    const camera: Camera = {
      id,
      name: name.trim(),
      video: { source: source.trim(), options: { rtsp_transport: "tcp" } },
    };
    this.map.set(id, camera);
    return camera;
  }

  update(id: string, name: string, source: string): Camera | null {
    const existing = this.map.get(id);
    if (!existing) return null;
    const updated: Camera = {
      ...existing,
      name: name.trim(),
      video: { ...existing.video, source: source.trim() },
    };
    this.map.set(id, updated);
    return updated;
  }

  remove(id: string): boolean {
    return this.map.delete(id);
  }
}

const DEMO_RTSP = process.env.DEMO_RTSP;

const list = [];

for (let i = 1; i <= 20; i++) {
  list.push({
    // Sử dụng padStart để tạo chuỗi format '01', '02', ..., '10'
    id: `CTR${i.toString().padStart(2, "0")}`,
    name: `Thanh${i}`,
    video: {
      source: DEMO_RTSP, // Đảm bảo bạn đã khai báo biến DEMO_RTSP trước đó
      options: { hwaccel: "auto", rtsp_transport: "tcp" },
    },
  });
}
export const cameraStore = new CameraStore(list);
