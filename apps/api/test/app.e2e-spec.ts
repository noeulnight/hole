import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from '../src/app.controller';
import { AppModule } from '../src/app.module';
import { SshService } from '../src/ssh/ssh.service';

describe('AppController (e2e)', () => {
  let controller: AppController;
  let moduleFixture: TestingModule;

  beforeEach(async () => {
    moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(SshService)
      .useValue({ onModuleDestroy: jest.fn() })
      .compile();
    controller = moduleFixture.get(AppController);
  });

  afterEach(async () => {
    await moduleFixture.close();
  });

  it('boots the app module and exposes the health payload', () => {
    expect(controller.health()).toEqual({
      service: 'hole-api',
      status: 'ok',
    });
  });
});
