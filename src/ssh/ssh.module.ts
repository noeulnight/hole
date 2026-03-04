import { Module } from '@nestjs/common';
import { SshService } from './ssh.service';
import { PortService } from './port.service';
import { SessionModule } from 'src/session/session.module';

@Module({
  imports: [SessionModule],
  providers: [PortService, SshService],
})
export class SshModule {}
