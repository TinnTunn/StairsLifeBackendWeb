import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy.validate', () => {
  let strategy: JwtStrategy;

  beforeEach(() => {
    const config = {
      get: (k: string) => (k === 'JWT_SECRET' ? 'test-secret' : undefined),
    } as unknown as ConfigService;
    strategy = new JwtStrategy(config);
  });

  it('TOLAK refresh token dipakai untuk akses endpoint (type=refresh)', () => {
    expect(() =>
      strategy.validate({
        sub: 'u1',
        email: 'a@b.c',
        role: 'admin',
        type: 'refresh',
      } as any),
    ).toThrow(UnauthorizedException);
  });

  it('map payload access → JwtUser {id,email,role}', () => {
    const user = strategy.validate({
      sub: 'u1',
      email: 'a@b.c',
      role: 'mahasiswa',
    } as any);
    expect(user).toEqual({ id: 'u1', email: 'a@b.c', role: 'mahasiswa' });
  });
});
