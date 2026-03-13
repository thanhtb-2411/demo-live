/** @type {import('next').NextConfig} */
const nextConfig = {
  /**
   * Proxy /api/* → NestJS Backend
   * Giúp client-side code không cần biết địa chỉ backend,
   * tránh vấn đề CORS, ẩn URL backend khỏi trình duyệt.
   */
  async rewrites() {
    const backendUrl = process.env.BACKEND_URL || "http://localhost:3001";
    return [
      {
        source: "/api/:path*",
        destination: `${backendUrl}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
