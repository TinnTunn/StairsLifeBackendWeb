import { SetMetadata } from '@nestjs/common';

// @Roles('admin', 'bisnis') — define role requirement
export const Roles = (...roles: string[]) => SetMetadata('roles', roles);
