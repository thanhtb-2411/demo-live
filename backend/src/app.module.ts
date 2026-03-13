import { Module } from "@nestjs/common";
import { AuthModule } from "./auth/auth.module";
import { CamerasModule } from "./cameras/cameras.module";

@Module({
  imports: [CamerasModule, AuthModule],
})
export class AppModule {}
