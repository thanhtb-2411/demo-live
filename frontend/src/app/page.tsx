import CameraViewer from "@/components/CameraViewer";

interface Camera {
  id: string;
  name: string;
}

/**
 * Server Component – fetch danh sách camera từ NestJS backend lúc render.
 * BACKEND_URL chỉ tồn tại phía server, không bị lộ ra trình duyệt.
 */
async function getCameras(): Promise<Camera[]> {
  const backendUrl = process.env.BACKEND_URL || "http://localhost:3001";
  try {
    const res = await fetch(`${backendUrl}/api/cameras`, {
      cache: "no-store", // Luôn lấy data mới nhất
    });
    if (!res.ok) return [];
    return res.json();
  } catch {
    // Backend chưa sẵn sàng → trả mảng rỗng, FE hiển thị thông báo
    return [];
  }
}

export default async function HomePage() {
  const cameras = await getCameras();

  return (
    <main>
      <CameraViewer initialCameras={cameras} />
    </main>
  );
}
