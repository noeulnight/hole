import { loadConfig } from '../src/config';

describe('configuration', () => {
  it('retains defaults and converts environment ports to numbers', () => {
    const config = loadConfig({
      TUNNEL_PORT_RANGE: '40000-40100',
      HTTP_PORT: '3100',
    });
    expect(config.HTTP_PORT).toBe(3100);
    expect(config.SSH_PORT).toBe(2222);
    expect(config.SSH_AUTH_MODE).toBe('noauth');
  });

  it.each([
    {},
    { TUNNEL_PORT_RANGE: '40000-40000' },
    { TUNNEL_PORT_RANGE: '40000-70000' },
    { TUNNEL_PORT_RANGE: '40000-40100', SSH_AUTH_MODE: 'password' },
    { TUNNEL_PORT_RANGE: '40000-40100', HTTP_PORT: '-1' },
  ])('rejects invalid settings: %j', (env) => {
    expect(() => loadConfig(env)).toThrow('Invalid configuration');
  });
});
