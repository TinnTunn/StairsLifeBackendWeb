import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { TokenService } from './token.service';

describe('TokenService', () => {
  const jwt = new JwtService({});
  let svc: TokenService;

  beforeEach(() => {
    const config = {
      get: (k: string) =>
        (
          ({
            JWT_SECRET: 'access-secret',
            JWT_REFRESH_SECRET: 'refresh-secret',
            JWT_EXPIRES_IN: '60m',
            JWT_REFRESH_EXPIRES_IN: '30d',
          }) as Record<string, string>
        )[k],
    } as unknown as ConfigService;
    svc = new TokenService(jwt, config);
  });

  it('access token valid dgn access secret & TIDAK ber-type refresh', () => {
    const token = svc.signAccess({ sub: 'u1', email: 'a@b.c', role: 'admin' });
    const decoded: any = jwt.verify(token, { secret: 'access-secret' });
    expect(decoded.sub).toBe('u1');
    expect(decoded.type).toBeUndefined();
  });

  it('refresh token ber-type=refresh & verifyRefresh sukses', () => {
    const rt = svc.signRefresh({ sub: 'u1', email: 'a@b.c', role: 'admin' });
    const decoded = svc.verifyRefresh(rt);
    expect(decoded.type).toBe('refresh');
  });

  it('refresh & access pakai secret BERBEDA (refresh invalid dgn access secret)', () => {
    const rt = svc.signRefresh({ sub: 'u1', email: 'a@b.c', role: 'admin' });
    expect(() => jwt.verify(rt, { secret: 'access-secret' })).toThrow();
  });
});
