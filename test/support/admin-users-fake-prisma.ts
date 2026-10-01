import { randomUUID } from 'node:crypto';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

type Row = Record<string, any>;

/**
 * Faux PrismaService dédié aux tests Admin Users (liste/filtre/pagination).
 * Les `select`/`include` sont IGNORÉS : on renvoie volontairement un sur-ensemble
 * (y compris `passwordHash`) pour prouver que les sérialiseurs ne fuient rien.
 */
export class AdminUsersFakePrisma {
  users: Row[] = [];
  clientProfiles: Row[] = [];
  jobberProfiles: Row[] = [];
  jobberServices: Row[] = [];
  services: Row[] = [];
  categories: Row[] = [];
  requirements: Row[] = [];
  skills: Row[] = [];
  areas: Row[] = [];
  missions: Row[] = [];
  incidents: Row[] = [];
  revokedSessionsFor: string[] = [];

  reset(): void {
    this.users = [];
    this.clientProfiles = [];
    this.jobberProfiles = [];
    this.jobberServices = [];
    this.services = [];
    this.categories = [];
    this.requirements = [];
    this.skills = [];
    this.areas = [];
    this.missions = [];
    this.incidents = [];
    this.revokedSessionsFor = [];
  }

  // ------------------------------------------------------------ seed helpers
  addUser(overrides: Row = {}): Row & { id: string } {
    const id = (overrides.id as string | undefined) ?? randomUUID();
    const now = new Date();
    const user = {
      firstName: 'Prénom',
      lastName: 'Nom',
      email: `${id}@example.test`,
      phone: `+229${Math.floor(Math.random() * 1e8)}`,
      passwordHash: 'argon2-secret-hash',
      dateOfBirth: new Date('1995-05-10T00:00:00.000Z'),
      emailVerifiedAt: now,
      phoneVerifiedAt: now,
      status: 'ACTIVE',
      role: 'USER',
      identityVerificationStatus: 'UNVERIFIED',
      legalGuardianStatus: 'NOT_REQUIRED',
      suspendedAt: null,
      suspensionReason: null,
      closedAt: null,
      createdAt: now,
      updatedAt: now,
      ...overrides,
      id,
    } as Row & { id: string };
    this.users.push(user);
    return user;
  }

  addClientProfile(userId: string): Row {
    const now = new Date();
    const row = { id: randomUUID(), userId, createdAt: now, updatedAt: now };
    this.clientProfiles.push(row);
    return row;
  }

  addJobberProfile(userId: string, overrides: Row = {}): Row {
    const now = new Date();
    const row = {
      id: randomUUID(),
      userId,
      status: 'ACTIVE',
      headline: null,
      bio: null,
      yearsOfExperience: null,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    };
    this.jobberProfiles.push(row);
    return row;
  }

  addMission(overrides: Row = {}): Row {
    const row = { id: randomUUID(), status: 'DRAFT', ...overrides };
    this.missions.push(row);
    return row;
  }

  // -------------------------------------------------------------- projection
  private project(user: Row): Row {
    const client =
      this.clientProfiles.find((p) => p.userId === user.id) ?? null;
    const jobber = this.jobberProfiles.find((p) => p.userId === user.id);
    const jobberProfile = jobber
      ? {
          ...jobber,
          _count: {
            services: this.jobberServices.filter(
              (s) => s.jobberProfileId === jobber.id,
            ).length,
            serviceAreas: this.areas.filter(
              (a) => a.jobberProfileId === jobber.id && a.isActive,
            ).length,
          },
          services: this.jobberServices
            .filter((s) => s.jobberProfileId === jobber.id)
            .map((js) => {
              const service = this.services.find((s) => s.id === js.serviceId)!;
              return {
                ...js,
                service: {
                  ...service,
                  category: this.categories.find(
                    (c) => c.id === service.categoryId,
                  ),
                  requirements: this.requirements.filter(
                    (r) => r.serviceId === service.id,
                  ),
                },
              };
            }),
          skills: this.skills.filter((s) => s.jobberProfileId === jobber.id),
          serviceAreas: this.areas.filter(
            (a) => a.jobberProfileId === jobber.id,
          ),
        }
      : null;
    return { ...user, clientProfile: client, jobberProfile };
  }

  // ------------------------------------------------------------- where logic
  private matchRelation(rel: Row | null, cond: Row): boolean {
    return Object.entries(cond).every(([op, arg]) => {
      if (op === 'is') {
        if (arg === null) return rel === null;
        return rel !== null && this.matchScalars(rel, arg);
      }
      if (op === 'isNot') {
        return arg === null ? rel !== null : rel === null;
      }
      throw new Error(`FakePrisma: relation op "${op}" non supporté`);
    });
  }

  private matchScalars(row: Row, where: Row): boolean {
    return Object.entries(where).every(([key, cond]) => {
      const value = row[key];
      if (cond === null) return value === null || value === undefined;
      if (typeof cond !== 'object' || cond instanceof Date) {
        return value === cond;
      }
      return Object.entries(cond as Row).every(([op, arg]) => {
        switch (op) {
          case 'contains':
            return (
              typeof value === 'string' &&
              value.toLowerCase().includes(String(arg).toLowerCase())
            );
          case 'mode':
            return true;
          case 'not':
            return arg === null ? value != null : value !== arg;
          case 'in':
            return (arg as unknown[]).includes(value);
          default:
            throw new Error(`FakePrisma: opérateur "${op}" non supporté`);
        }
      });
    });
  }

  private matchUser(user: Row, where: Row = {}): boolean {
    return Object.entries(where).every(([key, cond]) => {
      if (key === 'AND') {
        return (cond as Row[]).every((w) => this.matchUser(user, w));
      }
      if (key === 'OR') {
        return (cond as Row[]).some((w) => this.matchUser(user, w));
      }
      if (key === 'clientProfile') {
        return this.matchRelation(
          this.clientProfiles.find((p) => p.userId === user.id) ?? null,
          cond,
        );
      }
      if (key === 'jobberProfile') {
        return this.matchRelation(
          this.jobberProfiles.find((p) => p.userId === user.id) ?? null,
          cond,
        );
      }
      return this.matchScalars(user, { [key]: cond });
    });
  }

  // ---------------------------------------------------------------- delegates
  readonly user = {
    count: ({ where }: { where?: Row } = {}) =>
      Promise.resolve(
        this.users.filter((u) => this.matchUser(u, where)).length,
      ),
    findUnique: ({ where }: { where: Row }) => {
      const user = this.users.find((u) => u.id === where.id);
      return Promise.resolve(user ? this.project(user) : null);
    },
    findMany: ({
      where,
      orderBy,
      skip = 0,
      take,
    }: {
      where?: Row;
      orderBy?: Row[];
      skip?: number;
      take?: number;
    }) => {
      const sorters = (orderBy ?? []).map((o) => Object.entries(o)[0]);
      const found = this.users
        .filter((u) => this.matchUser(u, where))
        .sort((a, b) => {
          for (const [field, dir] of sorters) {
            const l = a[field] instanceof Date ? a[field].getTime() : a[field];
            const r = b[field] instanceof Date ? b[field].getTime() : b[field];
            if (l === r) continue;
            const result = l < r ? -1 : 1;
            return dir === 'desc' ? -result : result;
          }
          return 0;
        });
      const end = take === undefined ? undefined : skip + take;
      return Promise.resolve(
        found.slice(skip, end).map((u) => this.project(u)),
      );
    },
    update: ({ where, data }: { where: Row; data: Row }) => {
      const user = this.users.find((u) => u.id === where.id);
      if (!user) return Promise.reject(new Error('user: not found'));
      Object.assign(user, data, { updatedAt: new Date() });
      return Promise.resolve(this.project(user));
    },
  };

  readonly clientProfile = {
    count: () => Promise.resolve(this.clientProfiles.length),
  };
  readonly jobberProfile = {
    count: () => Promise.resolve(this.jobberProfiles.length),
  };

  readonly mission = {
    count: ({ where }: { where?: Row } = {}) =>
      Promise.resolve(
        this.missions.filter((m) => this.matchScalars(m, where ?? {})).length,
      ),
    groupBy: ({ by, where }: { by: string[]; where?: Row }) => {
      const [field] = by;
      const groups = new Map<unknown, number>();
      for (const m of this.missions.filter((row) =>
        this.matchScalars(row, where ?? {}),
      )) {
        groups.set(m[field], (groups.get(m[field]) ?? 0) + 1);
      }
      return Promise.resolve(
        [...groups.entries()].map(([value, n]) => ({
          [field]: value,
          _count: { _all: n },
        })),
      );
    },
  };

  readonly missionIncident = {
    count: ({ where }: { where?: Row } = {}) =>
      Promise.resolve(
        this.incidents.filter((i) => this.matchScalars(i, where ?? {})).length,
      ),
  };

  asPrismaService(): PrismaService {
    return this as unknown as PrismaService;
  }
}
