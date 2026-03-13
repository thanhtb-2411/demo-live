import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Cho phép Frontend (Next.js) gọi API từ origin khác trong môi trường dev
  app.enableCors({
    origin: "*",
    methods: "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS",
    allowedHeaders: "Content-Type, Accept, Authorization",
  });

  const port = process.env.PORT || 3001;
  await app.listen(port);
  console.log(`[Backend] Server đang chạy tại http://localhost:${port}`);
}

bootstrap();
