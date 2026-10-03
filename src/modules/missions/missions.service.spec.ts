import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  JobberStatus,
  MissionCancellationReason,
  MissionRiskFlag,
  MissionStatus,
} from '@prisma/client';
import { InMemoryPrisma } from '../../../test/support/in-memory-prisma';
import { InMemoryStorageProvider } from '../../infrastructure/storage/in-memory-storage.provider';
import {
  createUser,
  insertActiveAssignment,
  insertApplication,
  insertMission,
  publishMissionThroughReview,
  seedWorld,
  type World,
} from '../../../test/support/mission-fixtures';
import { MissionLifecycleService } from './mission-lifecycle.service';
import { MissionsService } from './missions.service';

describe('MissionsService', () => {
  let db: InMemoryPrisma;
  let world: World;
  let service: MissionsService;
  let lifecycle: MissionLifecycleService;

  const inDays = (days: number) =>
    new Date(Date.now() + days * 86_400_000).toISOString();

  async function assignJobber(
    missionId: string,
    jobberUserId = world.jobber.id,
  ) {
    const app = await insertApplication(db, missionId, jobberUserId, {
      status: 'SELECTED',
      selectedAt: new Date(),
    });
    await insertActiveAssignment(db, {
      missionId,
      jobberUserId,
      applicationId: app.id,
      selectedByUserId: world.client.id,
    });
  }

  const baseDto = () => ({
    serviceId: world.service.id,
    title: 'Ménage appartement',
    description: 'Nettoyage complet de mon appartement de 3 pièces.',
    city: 'Cotonou',
    clientPriceAmount: 15000,
  });

  beforeEach(async () => {
    db = new InMemoryPrisma();
    world = await seedWorld(db);
    lifecycle = new MissionLifecycleService(db.asPrismaService());
    const configService = {
      getOrThrow: jest.fn((key: string) => {
        if (key === 'app') return { nodeEnv: 'development' };
        if (key === 'payment') return { provider: 'mock' };
        throw new Error(`unknown config ${key}`);
      }),
    } as unknown as ConfigService;
    service = new MissionsService(
      db.asPrismaService(),
      lifecycle,
      configService,
      new InMemoryStorageProvider(),
    );
  });

  describe('ensureClientProfile', () => {
    it('lazily creates the ClientProfile when missing', async () => {
      expect(db.clientProfile.rows).toHaveLength(0);
      const profile = await service.ensureClientProfile(world.client.id);
      expect(profile.userId).toBe(world.client.id);
      expect(db.clientProfile.rows).toHaveLength(1);
    });

    it('reuses the existing ClientProfile', async () => {
      const first = await service.ensureClientProfile(world.client.id);
      const second = await service.ensureClientProfile(world.client.id);
      expect(second.id).toBe(first.id);
      expect(db.clientProfile.rows).toHaveLength(1);
    });
  });

  describe('generateReference', () => {
    it('formats KJ-YYYY-NNNNNN from the PostgreSQL sequence', async () => {
      db.$queryRaw.mockResolvedValueOnce([{ nextval: BigInt(42) }]);
      await expect(
        service.generateReference(new Date('2026-10-01T10:00:00Z')),
      ).resolves.toBe('KJ-2026-000042');
    });

    it('creates the sequence once when it does not exist yet, then retries', async () => {
      db.$queryRaw.mockRejectedValueOnce(
        new Error('relation "mission_reference_seq" does not exist'),
      );
      db.$queryRaw.mockResolvedValueOnce([{ nextval: BigInt(1) }]);
      await expect(
        service.generateReference(new Date('2026-01-01T00:00:00Z')),
      ).resolves.toBe('KJ-2026-000001');
      expect(db.$executeRaw).toHaveBeenCalledTimes(1);
    });

    it('does not swallow unrelated database errors', async () => {
      db.$queryRaw.mockRejectedValueOnce(new Error('connection refused'));
      await expect(service.generateReference()).rejects.toThrow(
        'connection refused',
      );
      expect(db.$executeRaw).not.toHaveBeenCalled();
    });
  });

  describe('create', () => {
    it('creates a DRAFT with forced XOF, owner and snapshots, plus history', async () => {
      const result = await service.create(world.client.id, {
        ...baseDto(),
        scheduledStartAt: inDays(2),
      });

      expect(result).toMatchObject({
        status: MissionStatus.DRAFT,
        currency: 'XOF',
        clientPriceAmount: 15000,
        clientUserId: world.client.id,
        selectedJobberUserId: null,
        minimumAge: 16,
        service: { id: world.service.id, name: 'Ménage', slug: 'menage' },
        category: { name: 'Maison & Entretien', slug: 'maison-entretien' },
      });
      expect(result.reference).toMatch(/^KJ-\d{4}-\d{6}$/);
      expect(db.clientProfile.rows).toHaveLength(1);
      expect(db.missionStatusHistory.rows).toHaveLength(1);
      expect(db.missionStatusHistory.rows[0]).toMatchObject({
        fromStatus: null,
        toStatus: MissionStatus.DRAFT,
      });
    });

    it('never trusts forged fields (status, currency, owner, snapshots)', async () => {
      const forged = {
        ...baseDto(),
        status: MissionStatus.COMPLETED,
        currency: 'USD',
        clientUserId: world.jobber.id,
        selectedJobberUserId: world.jobber.id,
        serviceNameSnapshot: 'Faux',
      };
      const result = await service.create(world.client.id, forged);
      expect(result.status).toBe(MissionStatus.DRAFT);
      expect(result.currency).toBe('XOF');
      expect(result.clientUserId).toBe(world.client.id);
      expect(result.selectedJobberUserId).toBeNull();
      expect(result.service.name).toBe('Ménage');
    });

    it('raises minimumAge to 18 for adult-only risk flags', async () => {
      const result = await service.create(world.client.id, {
        ...baseDto(),
        riskFlags: [MissionRiskFlag.DRIVING, MissionRiskFlag.DRIVING],
      });
      expect(result.minimumAge).toBe(18);
      expect(result.riskFlags).toEqual([MissionRiskFlag.DRIVING]);
    });

    it('keeps the service minimumAge when a non-adult flag is used', async () => {
      const result = await service.create(world.client.id, {
        ...baseDto(),
        riskFlags: [MissionRiskFlag.OTHER_RESTRICTED_ACTIVITY],
      });
      expect(result.minimumAge).toBe(16);
    });

    it('keeps an 18+ service minimumAge without any flag', async () => {
      await db.service.update({
        where: { id: world.service.id },
        data: { minimumAge: 18 },
      });
      const result = await service.create(world.client.id, baseDto());
      expect(result.minimumAge).toBe(18);
    });

    it('rejects an inactive service', async () => {
      await db.service.update({
        where: { id: world.service.id },
        data: { isActive: false },
      });
      await expect(
        service.create(world.client.id, baseDto()),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects a past schedule and half coordinates', async () => {
      await expect(
        service.create(world.client.id, {
          ...baseDto(),
          scheduledStartAt: new Date(Date.now() - 60_000).toISOString(),
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.create(world.client.id, { ...baseDto(), latitude: 6.36 }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('defaults workersNeeded to 1 when omitted', async () => {
      const result = await service.create(world.client.id, baseDto());
      expect(result.workersNeeded).toBe(1);
    });

    it('accepts an explicit workersNeeded value', async () => {
      const result = await service.create(world.client.id, {
        ...baseDto(),
        workersNeeded: 50,
      });
      expect(result.workersNeeded).toBe(50);
    });
  });

  describe('update', () => {
    it('updates every allowed field of a DRAFT and recomputes minimumAge', async () => {
      const mission = await insertMission(db, world);
      const result = await service.update(world.client.id, mission.id, {
        title: 'Nouveau titre',
        city: 'Porto-Novo',
        clientPriceAmount: 20000,
        riskFlags: [MissionRiskFlag.WORK_AT_HEIGHT],
        addressLine: null,
      });
      expect(result).toMatchObject({
        title: 'Nouveau titre',
        city: 'Porto-Novo',
        clientPriceAmount: 20000,
        minimumAge: 18,
        addressLine: null,
      });
      expect(result.status).toBe(MissionStatus.DRAFT);
    });

    it('a PUBLISHED mission only accepts descriptive fields', async () => {
      const mission = await insertMission(db, world, {
        status: MissionStatus.PUBLISHED,
      });
      const ok = await service.update(world.client.id, mission.id, {
        description: 'Description précisée après publication.',
      });
      expect(ok.description).toBe('Description précisée après publication.');
      await expect(
        service.update(world.client.id, mission.id, { clientPriceAmount: 1 }),
      ).rejects.toBeInstanceOf(ConflictException);
      await expect(
        service.update(world.client.id, mission.id, { city: 'Autre' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it.each([
      MissionStatus.PAYMENT_REQUIRED,
      MissionStatus.CONFIRMED,
      MissionStatus.CANCELLED,
    ])('refuses updates in %s', async (status) => {
      const mission = await insertMission(db, world, { status });
      await expect(
        service.update(world.client.id, mission.id, { title: 'Hack titre' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('hides the mission from non-owners and rejects empty patches', async () => {
      const mission = await insertMission(db, world);
      await expect(
        service.update(world.jobber.id, mission.id, { title: 'Pirate' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        service.update(world.client.id, mission.id, {}),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('cancel / requestCompletion facade', () => {
    it('cancel serialises with the actor-aware view', async () => {
      const mission = await insertMission(db, world, {
        status: MissionStatus.PAYMENT_REQUIRED,
        selectedJobberUserId: world.jobber.id,
        workersNeeded: 1,
      });
      await assignJobber(mission.id);
      const result = await service.cancel(world.jobber.id, mission.id, {
        reasonCode: MissionCancellationReason.JOBBER_UNAVAILABLE,
      });
      expect(result.status).toBe(MissionStatus.CANCELLED);
      // Jobber sélectionné mais mission annulée : adresse de nouveau masquée.
      expect(result).not.toHaveProperty('addressLine');
    });

    it('requestCompletion is reserved to the selected jobber', async () => {
      const mission = await insertMission(db, world, {
        status: MissionStatus.IN_PROGRESS,
        selectedJobberUserId: world.jobber.id,
      });
      await assignJobber(mission.id);
      await expect(
        service.requestCompletion(world.client.id, mission.id),
      ).rejects.toBeInstanceOf(ForbiddenException);
      const ok = await service.requestCompletion(world.jobber.id, mission.id);
      expect(ok.status).toBe(MissionStatus.COMPLETION_PENDING);
    });
  });

  describe('markPaymentConfirmed (internal only)', () => {
    it('moves legacy PAYMENT_REQUIRED → CONFIRMED', async () => {
      const mission = await insertMission(db, world, {
        status: MissionStatus.PAYMENT_REQUIRED,
        publishedAt: new Date(),
        selectedJobberUserId: world.jobber.id,
      });
      const result = await service.markPaymentConfirmed(mission.id);
      expect(result.status).toBe(MissionStatus.CONFIRMED);
    });
  });

  describe('getDetail (address privacy)', () => {
    it('owner sees the precise address', async () => {
      const mission = await insertMission(db, world, {
        status: MissionStatus.PUBLISHED,
      });
      const result = await service.getDetail(world.client.id, mission.id);
      expect(result).toMatchObject({
        viewerRole: 'CLIENT',
        addressLine: '12 rue des Cocotiers',
        latitude: 6.3654,
        longitude: 2.4183,
      });
    });

    it('non-selected jobber sees a published mission WITHOUT address nor coordinates', async () => {
      const mission = await insertMission(db, world, {
        status: MissionStatus.PUBLISHED,
      });
      await insertApplication(db, mission.id, world.jobber.id);
      const result = await service.getDetail(world.jobber.id, mission.id);
      expect(result).toMatchObject({ viewerRole: 'VISITOR', city: 'Cotonou' });
      expect(result).not.toHaveProperty('addressLine');
      expect(result).not.toHaveProperty('latitude');
      expect(result).not.toHaveProperty('longitude');
      expect(result).not.toHaveProperty('clientUserId');
      expect((result as any).myApplication.status).toBe('PENDING');
    });

    it.each([
      MissionStatus.APPLICATION_SELECTED,
      MissionStatus.PAYMENT_REQUIRED,
      MissionStatus.CONFIRMED,
      MissionStatus.IN_PROGRESS,
    ])('selected jobber sees the address in %s', async (status) => {
      const mission = await insertMission(db, world, {
        status,
        selectedJobberUserId: world.jobber.id,
      });
      await assignJobber(mission.id);
      const result = await service.getDetail(world.jobber.id, mission.id);
      expect(result).toMatchObject({
        viewerRole: 'JOBBER',
        addressLine: '12 rue des Cocotiers',
      });
    });

    it('a non-selected jobber cannot see a mission that is no longer published (404)', async () => {
      const mission = await insertMission(db, world, {
        status: MissionStatus.PAYMENT_REQUIRED,
        selectedJobberUserId: world.jobber.id,
      });
      await assignJobber(mission.id);
      await expect(
        service.getDetail(world.jobber2.id, mission.id),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('a draft is invisible to everyone but its owner', async () => {
      const mission = await insertMission(db, world);
      await expect(
        service.getDetail(world.jobber.id, mission.id),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('client detail exposes selected jobber public summary and counts applications', async () => {
      const mission = await insertMission(db, world, {
        status: MissionStatus.PAYMENT_REQUIRED,
        selectedJobberUserId: world.jobber.id,
      });
      await assignJobber(mission.id);
      const result: any = await service.getDetail(world.client.id, mission.id);
      expect(result.applicationsCount).toBe(1);
      expect(result.assignments).toHaveLength(1);
      expect(result.assignments[0].jobber).toEqual({
        userId: world.jobber.id,
        firstName: 'Jules',
        lastName: 'Jobber',
        headline: 'Pro du ménage',
        bio: 'Dix ans d’expérience',
      });
      expect(result.filledWorkers).toBe(1);
      expect(JSON.stringify(result)).not.toContain('hash-secret');
    });
  });

  describe('listAvailable', () => {
    it('lists published missions for any activated Jobber (explore-first)', async () => {
      await insertMission(db, world, { status: MissionStatus.PUBLISHED });
      await insertMission(db, world, { status: MissionStatus.DRAFT });
      await insertMission(db, world, {
        status: MissionStatus.PUBLISHED,
        selectedJobberUserId: world.jobber2.id,
      });

      const result = await service.listAvailable(world.jobber.id, {});

      expect(result.total).toBe(1);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].client?.displayName).toBeTruthy();
      expect(result.items[0].client).not.toHaveProperty('email');
      expect(result.items[0].client).not.toHaveProperty('phone');
      const json = JSON.stringify(result);
      expect(json).not.toContain('Cocotiers');
      expect(json).not.toContain('latitude');
      expect(json).not.toContain('longitude');
      expect(json).not.toContain('addressLine');
      expect(json).not.toContain('clientUserId');
    });

    it('lets unverified / incomplete Jobbers browse published missions', async () => {
      await insertMission(db, world, { status: MissionStatus.PUBLISHED });
      const draftJobber = await createUser(db);
      await db.jobberProfile.create({
        data: { userId: draftJobber.id, status: JobberStatus.DRAFT },
      });
      // Pas de JobberService ELIGIBLE — explore first.
      const result = await service.listAvailable(draftJobber.id, {});
      expect(result.total).toBeGreaterThanOrEqual(1);
    });

    it('still excludes the jobber’s own client missions from available list', async () => {
      await insertMission(db, world, {
        status: MissionStatus.PUBLISHED,
        minimumAge: 18,
      });
      const asClient = await service
        .listAvailable(world.client.id, {})
        .catch((e: unknown) => e);
      expect(asClient).toBeInstanceOf(ForbiddenException);

      const minor = await createUser(db, {
        dateOfBirth: new Date(new Date().getFullYear() - 17, 0, 1),
      });
      await db.jobberProfile.create({
        data: { userId: minor.id, status: JobberStatus.DRAFT },
      });
      // Browse autorisé même si âge < minimumAge (gate à la candidature).
      expect(
        (await service.listAvailable(minor.id, {})).total,
      ).toBeGreaterThanOrEqual(1);
    });

    it('filters by city case-insensitively and by service', async () => {
      await insertMission(db, world, {
        status: MissionStatus.PUBLISHED,
        city: 'Cotonou',
      });
      await insertMission(db, world, {
        status: MissionStatus.PUBLISHED,
        city: 'Parakou',
      });
      const result = await service.listAvailable(world.jobber.id, {
        city: 'parakou',
      });
      expect(result.items).toHaveLength(1);
      expect(result.items[0].city).toBe('Parakou');
      expect(
        (
          await service.listAvailable(world.jobber.id, {
            serviceId: '00000000-0000-4000-8000-000000000000',
          })
        ).items,
      ).toHaveLength(0);
    });

    it('requires an activated Jobber profile', async () => {
      await expect(
        service.listAvailable(world.client.id, {}),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('lists', () => {
    it('listMine returns only my missions with pagination', async () => {
      await insertMission(db, world);
      await insertMission(db, world, { status: MissionStatus.PUBLISHED });
      const other = await createUser(db);
      await insertMission(db, { ...world, client: other });

      const all = await service.listMine(world.client.id, {});
      expect(all.total).toBe(2);
      const published = await service.listMine(world.client.id, {
        status: MissionStatus.PUBLISHED,
        limit: 1,
      });
      expect(published.items).toHaveLength(1);
      expect(published.limit).toBe(1);
    });

    it('listMineAsJobber returns missions where I am selected', async () => {
      const mission = await insertMission(db, world, {
        status: MissionStatus.CONFIRMED,
        selectedJobberUserId: world.jobber.id,
      });
      await assignJobber(mission.id);
      await insertMission(db, world, { status: MissionStatus.PUBLISHED });
      const result = await service.listMineAsJobber(world.jobber.id, {});
      expect(result.total).toBe(1);
      expect(result.items[0]).toHaveProperty('addressLine');
    });
  });

  describe('admin', () => {
    it('adminList paginates and filters; adminDetail includes people and incidents', async () => {
      const mission = await insertMission(db, world, {
        status: MissionStatus.CONFIRMED,
        selectedJobberUserId: world.jobber.id,
      });
      await assignJobber(mission.id);
      await insertMission(db, world, { status: MissionStatus.PUBLISHED });

      const list = await service.adminList({
        status: MissionStatus.CONFIRMED,
      });
      expect(list.total).toBe(1);

      const detail = await service.adminDetail(mission.id);
      expect(detail.addressLine).toBe('12 rue des Cocotiers');
      expect(detail.client?.firstName).toBe('Cora');
      expect(detail.assignments[0]?.jobber?.lastName).toBe('Jobber');
      expect(detail.filledWorkers).toBe(1);
      expect(detail.incidents).toEqual([]);
      expect(JSON.stringify(detail)).not.toContain('hash-secret');
    });

    it('adminHistory returns chronological entries and 404s on unknown ids', async () => {
      const mission = await insertMission(db, world);
      await publishMissionThroughReview(
        lifecycle,
        mission.id,
        world.client.id,
        world.client.id,
      );
      const history = await service.adminHistory(mission.id);
      expect(history.items.length).toBeGreaterThanOrEqual(3);
      expect(history.items.some((h) => h.toStatus === 'PUBLISHED')).toBe(true);
      await expect(
        service.adminHistory('00000000-0000-4000-8000-000000000000'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
