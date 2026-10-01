import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { AdminUsersController } from './admin-users.controller';
import { AdminUsersService } from './admin-users.service';
import { ADMIN_USER_SELECT } from './admin-users.serializers';
import { AdminUsersQueryDto } from './dto/admin-users-queries.dto';
import { SuspendUserDto } from './dto/suspend-user.dto';

describe('AdminUsersController (surface HTTP)', () => {
  const proto = AdminUsersController.prototype as unknown as Record<
    string,
    unknown
  >;
  const routes = Object.getOwnPropertyNames(proto)
    .filter((name) => name !== 'constructor')
    .map((name) => {
      const handler = proto[name] as object;
      const method = Reflect.getMetadata(METHOD_METADATA, handler) as
        RequestMethod | undefined;
      const path = Reflect.getMetadata(PATH_METADATA, handler) as string;
      return method === undefined ? null : `${RequestMethod[method]} /${path}`;
    })
    .filter(Boolean)
    .sort();

  it('expose exactement les routes documentées', () => {
    expect(Reflect.getMetadata(PATH_METADATA, AdminUsersController)).toBe(
      'admin',
    );
    expect(routes).toEqual(
      [
        'GET /dashboard',
        'GET /users',
        'GET /users/:id',
        'GET /clients',
        'GET /jobbers',
        'GET /jobbers/:id',
        'POST /users/:id/suspend',
        'POST /users/:id/reactivate',
      ].sort(),
    );
  });

  it('est réservé à ADMIN / SUPER_ADMIN', () => {
    expect(Reflect.getMetadata(ROLES_KEY, AdminUsersController)).toEqual([
      'ADMIN',
      'SUPER_ADMIN',
    ]);
  });
});

describe('ADMIN_USER_SELECT', () => {
  it('ne sélectionne jamais de secret', () => {
    const keys = Object.keys(ADMIN_USER_SELECT);
    for (const forbidden of [
      'passwordHash',
      'sessions',
      'accountTokens',
      'phoneOtps',
    ]) {
      expect(keys).not.toContain(forbidden);
    }
  });
});

describe('DTO validation', () => {
  it('convertit "false" en false (et non true) pour les booléens de query', async () => {
    const dto = plainToInstance(
      AdminUsersQueryDto,
      { hasClientProfile: 'false', emailVerified: 'true', limit: '10' },
      { enableImplicitConversion: true },
    );
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.hasClientProfile).toBe(false);
    expect(dto.emailVerified).toBe(true);
    expect(dto.limit).toBe(10);
  });

  it('rejette un motif trop court / trop long', async () => {
    const short = plainToInstance(SuspendUserDto, { reason: ' ab ' });
    expect(await validate(short)).not.toHaveLength(0);
    const long = plainToInstance(SuspendUserDto, { reason: 'x'.repeat(501) });
    expect(await validate(long)).not.toHaveLength(0);
    const ok = plainToInstance(SuspendUserDto, { reason: ' abc ' });
    expect(await validate(ok)).toHaveLength(0);
    expect(ok.reason).toBe('abc');
  });
});

describe('AdminUsersService (requêtes Prisma)', () => {
  const actor: AuthenticatedUser = {
    id: 'actor-id',
    email: 'a@x.test',
    role: 'ADMIN',
    status: 'ACTIVE',
    sessionId: 's',
  };

  function build() {
    const prisma = {
      user: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };
    const sessions = { revokeAllUserSessions: jest.fn() };
    const service = new AdminUsersService(
      prisma as never,
      sessions as never,
      {} as never,
      {} as never,
    );
    return { prisma, sessions, service };
  }

  it('pagine avec skip/take et un tri stable', async () => {
    const { prisma, service } = build();
    prisma.user.count.mockResolvedValue(45);

    const result = await service.listUsers({
      page: 3,
      limit: 20,
      sort: 'lastName',
      order: 'asc',
    });

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 40,
        take: 20,
        orderBy: [{ lastName: 'asc' }, { id: 'asc' }],
        select: ADMIN_USER_SELECT,
      }),
    );
    expect(result).toMatchObject({
      page: 3,
      limit: 20,
      total: 45,
      totalPages: 3,
    });
  });

  it('construit la recherche (AND de tokens, OR de champs) et les filtres', async () => {
    const { prisma, service } = build();

    await service.listUsers({
      search: ' jean dupont ',
      status: 'SUSPENDED',
      role: 'ADMIN',
      hasClientProfile: false,
      hasJobberProfile: true,
      emailVerified: false,
      phoneVerified: true,
    });

    const { where } = prisma.user.findMany.mock.calls[0][0] as {
      where: { AND: unknown[] };
    };
    expect(where.AND).toEqual(
      expect.arrayContaining([
        { role: 'ADMIN' },
        { status: 'SUSPENDED' },
        { clientProfile: { is: null } },
        { jobberProfile: { isNot: null } },
        { emailVerifiedAt: null },
        { phoneVerifiedAt: { not: null } },
      ]),
    );
    const searchClauses = where.AND.filter(
      (c) => typeof c === 'object' && c !== null && 'OR' in c,
    ) as Array<{ OR: unknown[] }>;
    expect(searchClauses).toHaveLength(2);
    expect(searchClauses[0].OR).toEqual([
      { firstName: { contains: 'jean', mode: 'insensitive' } },
      { lastName: { contains: 'jean', mode: 'insensitive' } },
      { email: { contains: 'jean', mode: 'insensitive' } },
      { phone: { contains: 'jean', mode: 'insensitive' } },
    ]);
  });

  it('suspend : ne touche pas la base si la cible est protégée', async () => {
    const { prisma, sessions, service } = build();

    await expect(service.suspend(actor, actor.id, 'raison')).rejects.toThrow(
      'propre compte',
    );

    prisma.user.findUnique.mockResolvedValue({
      id: 't',
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
    });
    await expect(service.suspend(actor, 't', 'raison')).rejects.toThrow(
      'SUPER_ADMIN',
    );

    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(sessions.revokeAllUserSessions).not.toHaveBeenCalled();
  });
});
