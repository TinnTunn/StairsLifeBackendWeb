/**
 * Shape user yang di-inject oleh JwtStrategy.validate()
 * dan tersedia via @CurrentUser() decorator di setiap controller.
 */
export interface JwtUser {
  id: string;
  email: string;
  role: string;
}

/**
 * Raw JWT payload dari token (sebelum di-transform oleh validate()).
 */
export interface JwtPayload {
  sub: string; // user id
  email: string;
  role: string;
  iat?: number;
  exp?: number;
}
