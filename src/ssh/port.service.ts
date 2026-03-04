import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { parsePortRange } from 'src/common/utils/parse-port';

@Injectable()
export class PortService {
  private readonly logger: Logger = new Logger(PortService.name);
  private readonly freePorts: number[] = [];
  private readonly usedPorts = new Set<number>();

  constructor(private readonly configService: ConfigService) {
    const range = parsePortRange(
      configService.getOrThrow<string>('TUNNEL_PORT_RANGE'),
    );
    if (!range) throw new Error('TUNNEL_PORT_RANGE not parseable');

    for (let port = range.min; port <= range.max; port += 1) {
      this.freePorts.push(port);
    }

    this.logger.log(`Available ports: ${this.freePorts.length}`);
  }

  public acquire(): number | undefined {
    if (this.freePorts.length === 0) {
      return undefined;
    }

    const index = Math.floor(Math.random() * this.freePorts.length);
    const lastIndex = this.freePorts.length - 1;
    const selectedPort = this.freePorts[index];
    this.freePorts[index] = this.freePorts[lastIndex];
    this.freePorts.pop();

    this.usedPorts.add(selectedPort);
    this.logger.log(`Acquired port: ${selectedPort}`);
    return selectedPort;
  }

  public release(port: number) {
    if (!this.usedPorts.delete(port)) {
      return;
    }
    this.freePorts.push(port);
    this.logger.log(`Released port: ${port}`);
  }
}
