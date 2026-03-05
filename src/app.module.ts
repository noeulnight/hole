import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { AppController } from './app.controller';
import { ConfigModule } from '@nestjs/config';
import { validationSchema } from './common/config';
import { SshModule } from './ssh/ssh.module';
import { SessionModule } from './session/session.module';
import { ForwardMiddleware } from './common/middleware/forward.middleware';
import { EventEmitterModule } from '@nestjs/event-emitter';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validationSchema }),
    EventEmitterModule.forRoot(),
    SshModule,
    SessionModule,
  ],
  controllers: [AppController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(ForwardMiddleware)
      .exclude(
        { path: 'health', method: RequestMethod.ALL },
        { path: 'metrics', method: RequestMethod.ALL },
        { path: 'session', method: RequestMethod.ALL },
        { path: 'session/*path', method: RequestMethod.ALL },
      )
      .forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
