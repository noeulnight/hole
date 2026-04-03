import { Controller, Get, Header } from '@nestjs/common';
import { metricsRegistry } from './common/metrics';

@Controller()
export class AppController {
  @Get('health')
  public health() {
    return {
      service: 'hole-api',
      status: 'ok',
    };
  }

  @Get('metrics')
  @Header('Content-Type', metricsRegistry.contentType)
  public metrics(): Promise<string> {
    return metricsRegistry.metrics();
  }
}
