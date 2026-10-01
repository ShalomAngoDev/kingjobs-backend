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
      new MissionLifecycleService(prisma),
    );
  });

  const publishedMission = (overrides: Record<string, any> = {}) =>
    insertMission(db, world, { status: MissionStatus.PUBLISHED, ...overrides });

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
      expect(item.jobber).toEqual({
        userId: world.jobber.id,
        firstName: 'Jules',
        lastName: 'Jobber',
        headline: 'Pro du ménage',
        bio: 'Dix ans d’expérience',
      });
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
    it('selects and returns the mission in PAYMENT_REQUIRED with address', async () => {
      const mission = await publishedMission();
      const app = await insertApplication(db, mission.id, world.jobber.id);
      const result = await service.select(world.client.id, mission.id, app.id);
      expect(result.status).toBe(MissionStatus.PAYMENT_REQUIRED);
      expect(result.selectedJobberUserId).toBe(world.jobber.id);
      expect(result.addressLine).toBe('12 rue des Cocotiers');
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
