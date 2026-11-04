import type { Config } from './config';
import { parsePortRange } from './utils/parse-port';
import {
  portAcquireFailCounter,
  portPoolFreeGauge,
  portPoolUsedGauge,
} from './metrics';

export class PortPool {
  private readonly logger = console;
  private readonly freePorts: number[] = [];
  private readonly usedPorts = new Set<number>();

  constructor(config: Config) {
    const range = parsePortRange(config.TUNNEL_PORT_RANGE);
    if (!range) throw new Error('TUNNEL_PORT_RANGE not parseable');

    for (let port = range.min; port <= range.max; port += 1) {
      this.freePorts.push(port);
    }

    this.updatePortPoolMetrics();
    this.logger.log(`Available ports: ${this.freePorts.length}`);
  }

  public acquire(): number | undefined {
    if (this.freePorts.length === 0) {
      portAcquireFailCounter.inc();
      this.updatePortPoolMetrics();
      return undefined;
    }

    const index = Math.floor(Math.random() * this.freePorts.length);
    const lastIndex = this.freePorts.length - 1;
    const selectedPort = this.freePorts[index];
    this.freePorts[index] = this.freePorts[lastIndex];
    this.freePorts.pop();

    this.usedPorts.add(selectedPort);
    this.updatePortPoolMetrics();
    this.logger.log(`Acquired port: ${selectedPort}`);
    return selectedPort;
  }

  public release(port: number) {
    if (!this.usedPorts.delete(port)) {
      return;
    }
    this.freePorts.push(port);
    this.updatePortPoolMetrics();
    this.logger.log(`Released port: ${port}`);
  }

  private updatePortPoolMetrics() {
    portPoolFreeGauge.set(this.freePorts.length);
    portPoolUsedGauge.set(this.usedPorts.size);
  }
}
