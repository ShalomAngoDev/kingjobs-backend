import {
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { UserStatus } from '@prisma/client';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import type { AuthenticatedUser } from '../../modules/auth/auth.types';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }
    return super.canActivate(context);
  }

  handleRequest<TUser = AuthenticatedUser>(
    err: Error | null,
    user: TUser | false,
    _info: unknown,
    context: ExecutionContext,
  ): TUser {
    if (err || !user) {
      throw err ?? new UnauthorizedException('Authentification requise.');
    }

    const authUser = user as unknown as AuthenticatedUser;

    if (authUser.status === UserStatus.CLOSED) {
      throw new UnauthorizedException('Compte fermé.');
    }

    if (authUser.status === UserStatus.SUSPENDED) {
      const request = context.switchToHttp().getRequest<{ url?: string }>();
      const path = request.url ?? '';
      if (!path.includes('/auth/logout')) {
        throw new ForbiddenException('Compte suspendu.');
      }
    }

    return user;
  }
}
