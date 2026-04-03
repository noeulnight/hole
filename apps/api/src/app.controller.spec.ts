import { AppController } from './app.controller';

describe('AppController', () => {
  let controller: AppController;

  beforeEach(() => {
    controller = new AppController();
  });

  it('returns a healthy status payload', () => {
    expect(controller.health()).toEqual({
      service: 'hole-api',
      status: 'ok',
    });
  });
});
