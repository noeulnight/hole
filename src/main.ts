import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);
  app.enableShutdownHooks();

  const PORT = configService.get<number>('HTTP_PORT', 3000);
  await app.listen(PORT);
}
void bootstrap();
