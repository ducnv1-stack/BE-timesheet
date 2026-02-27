import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true,
  }));
  const host = process.env.HOST || '0.0.0.0';
  const port = process.env.PORT ?? 3001;
  await app.listen(port, host);
  console.log(`🚀 Backend running on http://${host}:${port}`);
}
bootstrap();
