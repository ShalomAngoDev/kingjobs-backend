import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  JobberServiceStatus,
  JobberStatus,
  MissionApplicationStatus,
  MissionStatus,
} from '@prisma/client';
import { InMemoryPrisma } from '../../../test/support/in-memory-prisma';
import {
  createJobber,
  createUser,
  insertApplication,
  insertMission,
  seedWorld,
  type World,
} from '../../../test/support/mission-fixtures';
import { JobberEligibilityService } from '../eligibility/jobber-eligibility.service';
import { MissionApplicationsService } from './mission-applications.service';
import { MissionLifecycleService } from './mission-lifecycle.service';

describe('MissionApplicationsService', () => {
  let db: InMemoryPrisma;
  let world: World;
  let service: MissionApplicationsService;

  beforeEach(async () => {
    db = new InMemoryPrisma();
    world = await seedWorld(db);
    const prisma = db.asPrismaService();
    service = new MissionApplicationsService(
      prisma,
      new JobberEligibilityService(),
      {
        loadApprovedDocumentTypeIds: jest.fn().mockResolvedValue(new Set()),
        recomputeForUser: jest.fn().mockResolvedValue(undefined),
        getDocumentRequirementsSummary: jest.fn(),
      } as never,
      new MissionLifecycleService(prisma),
      { send: jest.fn().mockResolvedValue(undefined) } as never,
      {
        createIfAbsent: jest.fn().mockResolvedValue(null),
        listForUser: jest.fn(),
        unreadCount: jest.fn(),
        markRead: jest.fn(),
        markAllRead: jest.fn(),
      } as never,
    );
  });

  const publishedMission = (overrides: Record<string, any> = {}) =>
    insertMission(db, world, {
      status: MissionStatus.PUBLISHED,
      publishedAt: new Date(),
      paymentConfirmedAt: new Date(),
      ...overrides,
    });

  describe('apply', () => {
    it('lets an eligible jobber apply to a published mission', async () => {
      const mission = await publishedMission();
      const result = await service.apply(world.jobber.id, mission.id, {
        message: '  Je suis dispo  ',
      });
      expect(result).toMatchObject({
        missionId: mission.id,
        status: MissionApplicationStatus.PENDING,
        message: 'Je suis dispo',
      });
    });

    it.each([['UNVERIFIED'], ['PENDING'], ['NEEDS_CHANGES'], ['REJECTED']])(
      'refuses a jobber whose identity is %s',
      async (identityVerificationStatus) => {
        const mission = await publishedMission();
        await db.user.update({
          where: { id: world.jobber.id },
          data: { identityVerificationStatus },
        });
        await expect(
          service.apply(world.jobber.id, mission.id, {}),
        ).rejects.toThrow(
          'Votre profil doit être vérifié avant de pouvoir candidater à une mission.',
        );
      },
    );

    it.each([
      [JobberStatus.DRAFT],
      [JobberStatus.PENDING_VERIFICATION],
      [JobberStatus.NEEDS_CHANGES],
    ])('refuses a jobber whose profile is %s', async (status) => {
      const mission = await publishedMission();
      await db.jobberProfile.updateMany({
        where: { userId: world.jobber.id },
        data: { status },
      });
      await expect(
        service.apply(world.jobber.id, mission.id, {}),
      ).rejects.toThrow(
        'Votre profil doit être vérifié avant de pouvoir candidater à une mission.',
      );
    });

    it('rejects a duplicate application (409)', async () => {
      const mission = await publishedMission();
      await service.apply(world.jobber.id, mission.id, {});
      await expect(
        service.apply(world.jobber.id, mission.id, {}),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('lets a jobber re-apply after withdrawing', async () => {
      const mission = await publishedMission();
      const first = await service.apply(world.jobber.id, mission.id, {});
      await service.withdraw(world.jobber.id, mission.id, first.id);
      const again = await service.apply(world.jobber.id, mission.id, {
        message: 'Finalement oui',
      });
      expect(again.id).toBe(first.id);
      expect(again.status).toBe(MissionApplicationStatus.PENDING);
      expect(again.withdrawnAt).toBeNull();
    });

    it('rejects applying to a non-published mission', async () => {
      const mission = await insertMission(db, world, {
        status: MissionStatus.PAYMENT_REQUIRED,
      });
      await expect(
        service.apply(world.jobber.id, mission.id, {}),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('hides a draft mission of someone else (404)', async () => {
      const mission = await insertMission(db, world);
      await expect(
        service.apply(world.jobber.id, mission.id, {}),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('forbids applying to your own mission', async () => {
      const mission = await publishedMission();
      await expect(
        service.apply(world.client.id, mission.id, {}),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('requires a Jobber profile', async () => {
      const mission = await publishedMission();
      const plain = await createUser(db);
      await expect(
        service.apply(plain.id, mission.id, {}),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('requires the service on the jobber profile', async () => {
      const mission = await publishedMission();
      const otherService = await db.service.create({
        data: {
          categoryId: world.category.id,
          name: 'Jardinage',
          slug: 'jardinage',
        },
      });
      const gardener = await createJobber(db, otherService.id);
      await expect(
        service.apply(gardener.id, mission.id, {}),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects a jobber whose profile is suspended (eligibility engine)', async () => {
      const mission = await publishedMission();
      await db.jobberProfile.updateMany({
        where: { userId: world.jobber.id },
        data: { status: JobberStatus.SUSPENDED },
      });
      await expect(
        service.apply(world.jobber.id, mission.id, {}),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects a suspended JobberService', async () => {
      const mission = await publishedMission();
      await db.jobberService.updateMany({
        where: {},
        data: { status: JobberServiceStatus.SUSPENDED },
      });
      await expect(
        service.apply(world.jobber.id, mission.id, {}),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects a pending service requirement (never silently satisfied)', async () => {
      const mission = await publishedMission();
      await db.serviceRequirement.create({
        data: {
          serviceId: world.service.id,
          type: 'DOCUMENT',
          code: 'ID_CARD',
          label: 'Pièce d’identité',
          isRequired: true,
        },
      });
      await expect(
        service.apply(world.jobber.id, mission.id, {}),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('enforces mission.minimumAge (18 for risky missions) against the jobber age', async () => {
      const minor = await createJobber(db, world.service.id, {
        dateOfBirth: new Date(new Date().getFullYear() - 17, 0, 1),
      });
      const ok = await publishedMission({ minimumAge: 16 });
      const adultOnly = await publishedMission({ minimumAge: 18 });

      await expect(service.apply(minor.id, ok.id, {})).resolves.toMatchObject({
        status: MissionApplicationStatus.PENDING,
      });
      await expect(
        service.apply(minor.id, adultOnly.id, {}),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('withdraw', () => {
    it('withdraws a PENDING application', async () => {
      const mission = await publishedMission();
      const app = await insertApplication(db, mission.id, world.jobber.id);
      const result = await service.withdraw(
        world.jobber.id,
        mission.id,
        app.id,
      );
      expect(result.status).toBe(MissionApplicationStatus.WITHDRAWN);
      expect(result.withdrawnAt).not.toBeNull();
    });

    it('cannot withdraw someone else’s application (404)', async () => {
      const mission = await publishedMission();
      const app = await insertApplication(db, mission.id, world.jobber.id);
      await expect(
        service.withdraw(world.jobber2.id, mission.id, app.id),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('cannot withdraw once SELECTED (must cancel)', async () => {
      const mission = await publishedMission();
      const app = await insertApplication(db, mission.id, world.jobber.id, {
        status: MissionApplicationStatus.SELECTED,
      });
      await expect(
        service.withdraw(world.jobber.id, mission.id, app.id),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('listForClient', () => {
    it('exposes only public jobber fields (no email, phone, hash, birth date)', async () => {
      const mission = await publishedMission();
      await insertApplication(db, mission.id, world.jobber.id);

      const result = await service.listForClient(world.client.id, mission.id);

      expect(result.items).toHaveLength(1);
      const [item] = result.items;
      expect(item.jobber).toMatchObject({
        userId: world.jobber.id,
        firstName: 'Jules',
        lastName: 'Jobber',
        headline: 'Pro du ménage',
        bio: 'Dix ans d’expérience',
      });
      expect(result.workersNeeded).toBe(1);
      expect(result.filledWorkers).toBe(0);
      expect(result.remainingWorkers).toBe(1);
      const json = JSON.stringify(result);
      expect(json).not.toContain('passwordHash');
      expect(json).not.toContain('hash-secret');
      expect(json).not.toContain('@example.test');
      expect(json).not.toContain('phone');
      expect(json).not.toContain('dateOfBirth');
    });

    it('hides withdrawn / rejected applications and refuses non-owners', async () => {
      const mission = await publishedMission();
      await insertApplication(db, mission.id, world.jobber.id, {
        status: MissionApplicationStatus.WITHDRAWN,
      });
      expect(
        (await service.listForClient(world.client.id, mission.id)).items,
      ).toHaveLength(0);
      await expect(
        service.listForClient(world.jobber.id, mission.id),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('select', () => {
    it('selects and returns the mission in CONFIRMED when publication is paid', async () => {
      const mission = await publishedMission();
      const app = await insertApplication(db, mission.id, world.jobber.id);
      const result = await service.select(world.client.id, mission.id, app.id);
      expect(result.status).toBe(MissionStatus.CONFIRMED);
      expect(result.selectedJobberUserId).toBe(world.jobber.id);
      expect(result.addressLine).toBe('12 rue des Cocotiers');
      expect(result.status).not.toBe(MissionStatus.PAYMENT_REQUIRED);
    });

    it('rejects a second select when workersNeeded=1', async () => {
      const mission = await publishedMission({ workersNeeded: 1 });
      const first = await insertApplication(db, mission.id, world.jobber.id);
      const second = await insertApplication(db, mission.id, world.jobber2.id);
      await service.select(world.client.id, mission.id, first.id);
      await expect(
        service.select(world.client.id, mission.id, second.id),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(
        (await db.missionApplication.findUnique({ where: { id: second.id } }))
          ?.status,
      ).toBe(MissionApplicationStatus.MISSION_FILLED);
    });

    it('closes remaining PENDING as MISSION_FILLED when the last slot is taken', async () => {
      const mission = await publishedMission({ workersNeeded: 1 });
      const chosen = await insertApplication(db, mission.id, world.jobber.id);
      const other = await insertApplication(db, mission.id, world.jobber2.id);
      await service.select(world.client.id, mission.id, chosen.id);
      expect(
        (await db.missionApplication.findUnique({ where: { id: other.id } }))
          ?.status,
      ).toBe(MissionApplicationStatus.MISSION_FILLED);
    });

    it('keeps selecting until workersNeeded then rejects extras', async () => {
      const mission = await publishedMission({
        workersNeeded: 2,
        clientPriceAmount: 20_000,
        estimatedAmount: 20_000,
        rateAmount: 10_000,
        rateScope: 'PER_JOBBER',
      });
      const a = await insertApplication(db, mission.id, world.jobber.id);
      const b = await insertApplication(db, mission.id, world.jobber2.id);
      const thirdJobber = await createJobber(db, world.service.id);
      const c = await insertApplication(db, mission.id, thirdJobber.id);

      expect(
        (await service.select(world.client.id, mission.id, a.id)).status,
      ).toBe(MissionStatus.PUBLISHED);
      expect(
        (await service.select(world.client.id, mission.id, b.id)).status,
      ).toBe(MissionStatus.CONFIRMED);
      await expect(
        service.select(world.client.id, mission.id, c.id),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('cancelAssignment reopens a slot', async () => {
      const mission = await publishedMission({
        workersNeeded: 2,
        clientPriceAmount: 20_000,
        estimatedAmount: 20_000,
        rateAmount: 10_000,
        rateScope: 'PER_JOBBER',
      });
      const a = await insertApplication(db, mission.id, world.jobber.id);
      const b = await insertApplication(db, mission.id, world.jobber2.id);
      await service.select(world.client.id, mission.id, a.id);
      await service.select(world.client.id, mission.id, b.id);

      const assignment = await db.missionAssignment.findFirst({
        where: { missionId: mission.id, jobberUserId: world.jobber.id },
      });
      const after = await service.cancelAssignment(
        world.client.id,
        mission.id,
        assignment!.id,
        'Slot libéré',
        true,
      );
      expect(after.status).toBe(MissionStatus.PUBLISHED);
    });

    it('refuses to select a jobber who is no longer eligible', async () => {
      const mission = await publishedMission();
      const app = await insertApplication(db, mission.id, world.jobber.id);
      await db.jobberProfile.updateMany({
        where: { userId: world.jobber.id },
        data: { status: JobberStatus.REJECTED },
      });
      await expect(
        service.select(world.client.id, mission.id, app.id),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(
        (await db.mission.findUnique({ where: { id: mission.id } }))?.status,
      ).toBe(MissionStatus.PUBLISHED);
    });

    it('refuses selection by a non-owner (404)', async () => {
      const mission = await publishedMission();
      const app = await insertApplication(db, mission.id, world.jobber.id);
      await expect(
        service.select(world.jobber.id, mission.id, app.id),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
