import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';

/** Fake ExecutionContext minimal untuk RolesGuard. */
function ctxWith(user: any): any {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => ({}),
    getClass: () => ({}),
  };
}

describe('RolesGuard', () => {
  let reflector: Reflector;
  let guard: RolesGuard;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new RolesGuard(reflector);
  });

  it('izinkan bila endpoint tidak punya @Roles requirement', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    expect(guard.canActivate(ctxWith({ id: '1', role: 'mahasiswa' }))).toBe(true);
  });

  it('izinkan bila role user termasuk yang diizinkan', () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue(['bisnis', 'admin']);
    expect(guard.canActivate(ctxWith({ id: '1', role: 'bisnis' }))).toBe(true);
  });

  it('tolak (Forbidden) bila role user tidak cocok', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['admin']);
    expect(() =>
      guard.canActivate(ctxWith({ id: '1', role: 'mahasiswa' })),
    ).toThrow(ForbiddenException);
  });

  it('tolak (Forbidden) bila tidak ada user — fail-closed', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['admin']);
    expect(() => guard.canActivate(ctxWith(undefined))).toThrow(
      ForbiddenException,
    );
  });
});
