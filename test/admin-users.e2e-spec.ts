import {
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { adminDb, AdminUsersE2eModule } from './admin-users-e2e.module';

describe('Admin users API e2e (fake prisma)', () => {
  let app: INestApplication;
  let user: { id: string } & Record<string, any>;
  let admin: { id: string } & Record<string, any>;
  let superAdmin: { id: string } & Record<string, any>;

  const http = () => request(app.getHttpServer());
  const as = (u: { id: string }) => ({ 'x-test-user-id': u.id });
  const get = (path: string, who = admin) =>
    http().get(`/api/v1${path}`).set(as(who));
  const post = (path: string, who = admin) =>
    http().post(`/api/v1${path}`).set(as(who));

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AdminUsersE2eModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    adminDb.reset();
    user = adminDb.addUser({ firstName: 'Simple', lastName: 'User' });
    admin = adminDb.addUser({
      firstName: 'Ada',
      lastName: 'Admin',
      role: 'ADMIN',
    });
    superAdmin = adminDb.addUser({
      firstName: 'Sam',
      lastName: 'Super',
      role: 'SUPER_ADMIN',
    });
  });

  describe('contrôle d’accès', () => {
    const routes: Array<['get' | 'post', string]> = [
      ['get', '/admin/dashboard'],
      ['get', '/admin/users'],
      ['get', `/admin/users/${randomUUID()}`],
      ['get', '/admin/clients'],
      ['get', '/admin/jobbers'],
      ['get', `/admin/jobbers/${randomUUID()}`],
      ['post', `/admin/users/${randomUUID()}/suspend`],
      ['post', `/admin/users/${randomUUID()}/reactivate`],
    ];

    it.each(routes)(
      '%s %s → 401 sans authentification',
      async (method, path) => {
        await http()[method](`/api/v1${path}`).expect(401);
      },
    );

    it.each(routes)('%s %s → 403 pour USER', async (method, path) => {
      await http()
        [method](`/api/v1${path}`)
        .set(as(user))
        .send({ reason: 'abus répété' })
        .expect(403);
    });

    it('ADMIN et SUPER_ADMIN → 200 sur les lectures', async () => {
      for (const who of [admin, superAdmin]) {
        await get('/admin/dashboard', who).expect(200);
        await get('/admin/users', who).expect(200);
        await get('/admin/clients', who).expect(200);
        await get('/admin/jobbers', who).expect(200);
        await get(`/admin/users/${user.id}`, who).expect(200);
      }
    });
  });

  describe('GET /admin/dashboard', () => {
    it('renvoie uniquement des agrégats', async () => {
      adminDb.addClientProfile(user.id);
      const jobberUser = adminDb.addUser();
      adminDb.addJobberProfile(jobberUser.id);
      for (const status of [
        'PUBLISHED',
        'PAYMENT_REQUIRED',
        'PAYMENT_REQUIRED',
        'CONFIRMED',
        'READY_TO_START',
        'IN_PROGRESS',
        'COMPLETION_PENDING',
        'COMPLETED',
      ]) {
        adminDb.addMission({ status, clientUserId: user.id });
      }
      adminDb.incidents.push(
        { id: randomUUID(), status: 'OPEN' },
        { id: randomUUID(), status: 'UNDER_REVIEW' },
        { id: randomUUID(), status: 'RESOLVED' },
        { id: randomUUID(), status: 'CLOSED' },
      );

      const { body } = await get('/admin/dashboard').expect(200);

      expect(body).toMatchObject({
        usersTotal: 4,
        clientsTotal: 1,
        jobbersTotal: 1,
        missionsTotal: 8,
        missionsActive: 4,
        missionsPaymentRequired: 2,
        incidentsOpen: 2,
      });
      expect(Object.keys(body.missionsByStatus).sort()).toEqual(
        [
          'DRAFT',
          'PUBLISHED',
          'APPLICATION_SELECTED',
          'PAYMENT_REQUIRED',
          'CONFIRMED',
          'READY_TO_START',
          'IN_PROGRESS',
          'COMPLETION_PENDING',
          'COMPLETED',
          'CANCELLED',
          'DISPUTED',
        ].sort(),
      );
      expect(body.missionsByStatus.PAYMENT_REQUIRED).toBe(2);
      expect(body.missionsByStatus.DRAFT).toBe(0);
      expect(Array.isArray(body.items)).toBe(false);
    });

    it('fonctionne base vide (zéros)', async () => {
      adminDb.reset();
      const admin2 = adminDb.addUser({ role: 'ADMIN' });
      const { body } = await get('/admin/dashboard', admin2).expect(200);
      expect(body.missionsTotal).toBe(0);
      expect(body.incidentsOpen).toBe(0);
    });
  });

  describe('GET /admin/users', () => {
    it('applique pagination et renvoie le format attendu', async () => {
      for (let i = 0; i < 7; i++) {
        adminDb.addUser({
          lastName: `Lot${i}`,
          createdAt: new Date(2026, 0, 1 + i),
        });
      }
      // 10 users au total

      const page1 = await get('/admin/users?limit=4').expect(200);
      expect(page1.body).toMatchObject({
        page: 1,
        limit: 4,
        total: 10,
        totalPages: 3,
      });
      expect(page1.body.items).toHaveLength(4);

      const page3 = await get('/admin/users?limit=4&page=3').expect(200);
      expect(page3.body.items).toHaveLength(2);

      const ids = new Set([
        ...page1.body.items.map((u: any) => u.id),
        ...(await get('/admin/users?limit=4&page=2')).body.items.map(
          (u: any) => u.id,
        ),
        ...page3.body.items.map((u: any) => u.id),
      ]);
      expect(ids.size).toBe(10);
    });

    it('défaut page=1 limit=20 ; refuse limit>100, page<1, params inconnus', async () => {
      const { body } = await get('/admin/users').expect(200);
      expect(body).toMatchObject({ page: 1, limit: 20 });
      await get('/admin/users?limit=101').expect(400);
      await get('/admin/users?limit=0').expect(400);
      await get('/admin/users?page=0').expect(400);
      await get('/admin/users?sort=passwordHash').expect(400);
      await get('/admin/users?order=sideways').expect(400);
      await get('/admin/users?status=NOPE').expect(400);
      await get('/admin/users?hasClientProfile=maybe').expect(400);
      await get('/admin/users?foo=bar').expect(400);
      await get('/admin/users?limit=100').expect(200);
    });

    it('expose les champs attendus et AUCUN secret', async () => {
      const { body } = await get('/admin/users').expect(200);
      const item = body.items.find((u: any) => u.id === user.id);
      expect(Object.keys(item).sort()).toEqual(
        [
          'age',
          'createdAt',
          'dateOfBirth',
          'email',
          'emailVerifiedAt',
          'firstName',
          'hasClientProfile',
          'hasJobberProfile',
          'id',
          'identityVerificationStatus',
          'isMinor',
          'jobberStatus',
          'lastName',
          'legalGuardianStatus',
          'phone',
          'phoneVerifiedAt',
          'role',
          'status',
          'updatedAt',
        ].sort(),
      );
      expect(item.dateOfBirth).toBe('1995-05-10');
      expect(item.isMinor).toBe(false);
      expect(item.age).toBeGreaterThanOrEqual(30);
      const raw = JSON.stringify(body);
      expect(raw).not.toContain('passwordHash');
      expect(raw).not.toContain('argon2-secret-hash');
    });

    it('recherche par nom, email, téléphone et nom complet', async () => {
      adminDb.addUser({
        firstName: 'Jean',
        lastName: 'Dupont',
        email: 'jean.dupont@mail.test',
        phone: '+22997000001',
      });
      adminDb.addUser({
        firstName: 'Jeanne',
        lastName: 'Martin',
        email: 'jm@mail.test',
        phone: '+22997000002',
      });

      const byFirst = await get('/admin/users?search=jean').expect(200);
      expect(byFirst.body.total).toBe(2);

      const byFull = await get('/admin/users?search=Jean%20Dupont').expect(200);
      expect(byFull.body.total).toBe(1);
      expect(byFull.body.items[0].lastName).toBe('Dupont');

      const byEmail = await get('/admin/users?search=JM@MAIL').expect(200);
      expect(byEmail.body.total).toBe(1);

      const byPhone = await get('/admin/users?search=97000002').expect(200);
      expect(byPhone.body.items[0].lastName).toBe('Martin');

      const none = await get('/admin/users?search=zzzzz').expect(200);
      expect(none.body).toMatchObject({ total: 0, totalPages: 0, items: [] });
    });

    it('filtre par status, role, profils et vérifications', async () => {
      const suspended = adminDb.addUser({ status: 'SUSPENDED' });
      const clientUser = adminDb.addUser({ emailVerifiedAt: null });
      adminDb.addClientProfile(clientUser.id);
      const jobberUser = adminDb.addUser({ phoneVerifiedAt: null });
      adminDb.addJobberProfile(jobberUser.id, {
        status: 'PENDING_VERIFICATION',
      });
      const both = adminDb.addUser();
      adminDb.addClientProfile(both.id);
      adminDb.addJobberProfile(both.id);

      const ids = async (qs: string) =>
        (await get(`/admin/users?${qs}`).expect(200)).body.items.map(
          (u: any) => u.id,
        );

      expect(await ids('status=SUSPENDED')).toEqual([suspended.id]);
      expect(await ids('role=ADMIN')).toEqual([admin.id]);
      expect(await ids('role=SUPER_ADMIN')).toEqual([superAdmin.id]);
      expect((await ids('hasClientProfile=true')).sort()).toEqual(
        [clientUser.id, both.id].sort(),
      );
      expect(await ids('hasClientProfile=false')).not.toContain(clientUser.id);
      expect((await ids('hasJobberProfile=true')).sort()).toEqual(
        [jobberUser.id, both.id].sort(),
      );
      expect(await ids('hasClientProfile=true&hasJobberProfile=true')).toEqual([
        both.id,
      ]);
      expect(await ids('emailVerified=false')).toEqual([clientUser.id]);
      expect(await ids('phoneVerified=false')).toEqual([jobberUser.id]);
      expect(await ids('emailVerified=true')).not.toContain(clientUser.id);
    });

    it('trie par lastName / email / createdAt avec order', async () => {
      adminDb.reset();
      const a = adminDb.addUser({
        role: 'ADMIN',
        lastName: 'Bravo',
        email: 'c@x.test',
        createdAt: new Date(2026, 0, 1),
      });
      adminDb.addUser({
        lastName: 'Alpha',
        email: 'b@x.test',
        createdAt: new Date(2026, 0, 2),
      });
      adminDb.addUser({
        lastName: 'Charlie',
        email: 'a@x.test',
        createdAt: new Date(2026, 0, 3),
      });

      const names = async (qs: string) =>
        (await get(`/admin/users?${qs}`, a).expect(200)).body.items.map(
          (u: any) => u.lastName,
        );

      expect(await names('sort=lastName&order=asc')).toEqual([
        'Alpha',
        'Bravo',
        'Charlie',
      ]);
      expect(await names('sort=email&order=asc')).toEqual([
        'Charlie',
        'Alpha',
        'Bravo',
      ]);
      expect(await names('sort=createdAt&order=desc')).toEqual([
        'Charlie',
        'Alpha',
        'Bravo',
      ]);
      expect(await names('')).toEqual(['Charlie', 'Alpha', 'Bravo']);
    });
  });

  describe('GET /admin/users/:id', () => {
    it('renvoie le détail avec profils null', async () => {
      const { body } = await get(`/admin/users/${user.id}`).expect(200);
      expect(body).toMatchObject({
        id: user.id,
        clientProfile: null,
        jobberProfile: null,
        suspendedAt: null,
      });
      expect(JSON.stringify(body)).not.toContain('passwordHash');
    });

    it('renvoie les résumés client et jobber', async () => {
      adminDb.addClientProfile(user.id);
      adminDb.addJobberProfile(user.id, {
        headline: 'Plombier',
        bio: 'Plus de dix ans d’expérience en plomberie.',
      });
      adminDb.addMission({ clientUserId: user.id, status: 'DRAFT' });
      adminDb.addMission({ clientUserId: user.id, status: 'COMPLETED' });
      adminDb.addMission({ clientUserId: admin.id, status: 'COMPLETED' });

      const { body } = await get(`/admin/users/${user.id}`).expect(200);
      expect(body.clientProfile).toMatchObject({ missionsCount: 2 });
      expect(body.jobberProfile).toMatchObject({
        headline: 'Plombier',
        servicesCount: 0,
        zonesCount: 0,
      });
      expect(body.jobberProfile.profileCompletion.percentage).toBeGreaterThan(
        0,
      );
      expect(body.hasClientProfile).toBe(true);
      expect(body.hasJobberProfile).toBe(true);
    });

    it('404 si inconnu, 400 si UUID invalide', async () => {
      await get(`/admin/users/${randomUUID()}`).expect(404);
      await get('/admin/users/not-a-uuid').expect(400);
    });
  });

  describe('GET /admin/clients', () => {
    it('liste uniquement les users avec ClientProfile et missionsCount', async () => {
      const c1 = adminDb.addUser({ firstName: 'Cora' });
      const c2 = adminDb.addUser({ firstName: 'Carl', status: 'SUSPENDED' });
      adminDb.addClientProfile(c1.id);
      adminDb.addClientProfile(c2.id);
      adminDb.addMission({ clientUserId: c1.id });
      adminDb.addMission({ clientUserId: c1.id });
      adminDb.addMission({ clientUserId: c2.id });

      const all = await get('/admin/clients').expect(200);
      expect(all.body.total).toBe(2);
      const byId = Object.fromEntries(
        all.body.items.map((i: any) => [i.id, i.missionsCount]),
      );
      expect(byId).toEqual({ [c1.id]: 2, [c2.id]: 1 });
      expect(all.body.items[0]).toHaveProperty('clientProfileId');

      const suspended = await get('/admin/clients?status=SUSPENDED').expect(
        200,
      );
      expect(suspended.body.items.map((i: any) => i.id)).toEqual([c2.id]);

      const search = await get('/admin/clients?search=cora').expect(200);
      expect(search.body.total).toBe(1);

      const paged = await get('/admin/clients?limit=1&page=2').expect(200);
      expect(paged.body).toMatchObject({ total: 2, totalPages: 2 });
      expect(paged.body.items).toHaveLength(1);
    });
  });

  describe('GET /admin/jobbers', () => {
    it('liste, filtres jobberStatus / identité, compteurs', async () => {
      const j1 = adminDb.addUser({
        firstName: 'Jules',
        identityVerificationStatus: 'VERIFIED',
      });
      const j2 = adminDb.addUser({ firstName: 'Julie' });
      adminDb.addJobberProfile(j1.id, { status: 'ACTIVE' });
      const p2 = adminDb.addJobberProfile(j2.id, {
        status: 'PENDING_VERIFICATION',
      });
      adminDb.areas.push(
        { id: randomUUID(), jobberProfileId: p2.id, isActive: true },
        { id: randomUUID(), jobberProfileId: p2.id, isActive: false },
      );
      adminDb.addClientProfile(user.id); // ne doit pas apparaître

      const all = await get('/admin/jobbers').expect(200);
      expect(all.body.total).toBe(2);
      const item2 = all.body.items.find((i: any) => i.id === j2.id);
      expect(item2).toMatchObject({
        jobberProfileId: p2.id,
        jobberStatus: 'PENDING_VERIFICATION',
        servicesCount: 0,
        zonesCount: 1,
      });
      expect(item2.profileCompletion).toEqual(
        expect.objectContaining({ percentage: expect.any(Number) }),
      );

      const pending = await get(
        '/admin/jobbers?jobberStatus=PENDING_VERIFICATION',
      ).expect(200);
      expect(pending.body.items.map((i: any) => i.id)).toEqual([j2.id]);

      const verified = await get(
        '/admin/jobbers?identityVerificationStatus=VERIFIED',
      ).expect(200);
      expect(verified.body.items.map((i: any) => i.id)).toEqual([j1.id]);

      const search = await get('/admin/jobbers?search=julie').expect(200);
      expect(search.body.items.map((i: any) => i.id)).toEqual([j2.id]);

      await get('/admin/jobbers?jobberStatus=NOPE').expect(400);
    });
  });

  describe('GET /admin/jobbers/:id', () => {
    it('renvoie services, skills, zones et éligibilité', async () => {
      const j = adminDb.addUser({ firstName: 'Jules' });
      const profile = adminDb.addJobberProfile(j.id, { status: 'ACTIVE' });
      const category = { id: randomUUID(), name: 'Maison', slug: 'maison' };
      adminDb.categories.push(category);
      const okService = {
        id: randomUUID(),
        categoryId: category.id,
        name: 'Ménage',
        slug: 'menage',
        isActive: true,
        minimumAge: 16,
      };
      const strictService = {
        id: randomUUID(),
        categoryId: category.id,
        name: 'Sécurité',
        slug: 'securite',
        isActive: true,
        minimumAge: 40,
      };
      adminDb.services.push(okService, strictService);
      adminDb.jobberServices.push(
        {
          id: randomUUID(),
          jobberProfileId: profile.id,
          serviceId: okService.id,
          status: 'ELIGIBLE',
          createdAt: new Date(),
        },
        {
          id: randomUUID(),
          jobberProfileId: profile.id,
          serviceId: strictService.id,
          status: 'PENDING_ELIGIBILITY',
          createdAt: new Date(),
        },
      );
      adminDb.skills.push({
        id: randomUUID(),
        jobberProfileId: profile.id,
        serviceId: null,
        name: 'Repassage',
      });
      adminDb.areas.push({
        id: randomUUID(),
        jobberProfileId: profile.id,
        countryCode: 'BJ',
        administrativeArea: null,
        city: 'Cotonou',
        district: 'Fidjrossè',
        latitude: 6.36,
        longitude: 2.41,
        radiusKm: 5,
        isActive: true,
      });

      const { body } = await get(`/admin/jobbers/${j.id}`).expect(200);

      expect(body.id).toBe(j.id);
      expect(body.jobberProfile).toMatchObject({
        id: profile.id,
        servicesCount: 2,
        zonesCount: 1,
      });
      const menage = body.services.find((s: any) => s.slug === 'menage');
      expect(menage).toMatchObject({
        name: 'Ménage',
        minimumAge: 16,
        status: 'ELIGIBLE',
        category: { name: 'Maison' },
        eligibility: { eligible: true, reasons: [] },
      });
      const secu = body.services.find((s: any) => s.slug === 'securite');
      expect(secu.eligibility.eligible).toBe(false);
      expect(secu.eligibility.reasons.map((r: any) => r.code)).toContain(
        'MINIMUM_AGE_NOT_MET',
      );
      expect(body.eligibility).toEqual({
        eligibleServicesCount: 1,
        totalServices: 2,
      });
      expect(body.skills).toEqual([
        expect.objectContaining({ name: 'Repassage' }),
      ]);
      expect(body.serviceAreas[0]).toMatchObject({
        city: 'Cotonou',
        radiusKm: 5,
        isActive: true,
      });
      expect(JSON.stringify(body)).not.toContain('passwordHash');
    });

    it('404 pour un user sans JobberProfile ou inconnu', async () => {
      await get(`/admin/jobbers/${user.id}`).expect(404);
      await get(`/admin/jobbers/${randomUUID()}`).expect(404);
    });
  });

  describe('POST /admin/users/:id/suspend', () => {
    it('valide le motif (3..500 caractères, obligatoire)', async () => {
      await post(`/admin/users/${user.id}/suspend`).send({}).expect(400);
      await post(`/admin/users/${user.id}/suspend`)
        .send({ reason: 'ab' })
        .expect(400);
      await post(`/admin/users/${user.id}/suspend`)
        .send({ reason: '  a ' })
        .expect(400);
      await post(`/admin/users/${user.id}/suspend`)
        .send({ reason: 'x'.repeat(501) })
        .expect(400);
      await post(`/admin/users/${user.id}/suspend`)
        .send({ reason: 'valide', extra: 1 })
        .expect(400);
      expect(user.status).toBe('ACTIVE');
    });

    it('ADMIN suspend un USER : statut, motif, sessions révoquées', async () => {
      const { body } = await post(`/admin/users/${user.id}/suspend`)
        .send({ reason: '  Fraude détectée  ' })
        .expect(200);
      expect(body).toMatchObject({
        id: user.id,
        status: 'SUSPENDED',
        suspensionReason: 'Fraude détectée',
      });
      expect(body.suspendedAt).toEqual(expect.any(String));
      expect(JSON.stringify(body)).not.toContain('passwordHash');
      expect(adminDb.revokedSessionsFor).toEqual([user.id]);
      expect(user.status).toBe('SUSPENDED');
    });

    it('SUPER_ADMIN peut suspendre un ADMIN', async () => {
      await post(`/admin/users/${admin.id}/suspend`, superAdmin)
        .send({ reason: 'Revue sécurité' })
        .expect(200);
      expect(admin.status).toBe('SUSPENDED');
    });

    it('ADMIN ne peut pas suspendre un SUPER_ADMIN', async () => {
      await post(`/admin/users/${superAdmin.id}/suspend`)
        .send({ reason: 'tentative' })
        .expect(403);
      expect(superAdmin.status).toBe('ACTIVE');
      expect(adminDb.revokedSessionsFor).toEqual([]);
    });

    it('refuse l’auto-suspension (ADMIN et SUPER_ADMIN)', async () => {
      await post(`/admin/users/${admin.id}/suspend`)
        .send({ reason: 'moi-même' })
        .expect(403);
      await post(`/admin/users/${superAdmin.id}/suspend`, superAdmin)
        .send({ reason: 'moi-même' })
        .expect(403);
      expect(admin.status).toBe('ACTIVE');
      expect(superAdmin.status).toBe('ACTIVE');
    });

    it('404 inconnu, 422 fermé, 409 déjà suspendu', async () => {
      await post(`/admin/users/${randomUUID()}/suspend`)
        .send({ reason: 'inconnu' })
        .expect(404);

      const closed = adminDb.addUser({ status: 'CLOSED' });
      await post(`/admin/users/${closed.id}/suspend`)
        .send({ reason: 'fermé' })
        .expect(422);

      const already = adminDb.addUser({ status: 'SUSPENDED' });
      await post(`/admin/users/${already.id}/suspend`)
        .send({ reason: 'déjà' })
        .expect(409);
    });
  });

  describe('POST /admin/users/:id/reactivate', () => {
    it('réactive un compte suspendu et efface le motif', async () => {
      const target = adminDb.addUser({
        status: 'SUSPENDED',
        suspendedAt: new Date(),
        suspensionReason: 'Fraude',
      });
      const { body } = await post(
        `/admin/users/${target.id}/reactivate`,
      ).expect(200);
      expect(body).toMatchObject({
        status: 'ACTIVE',
        suspendedAt: null,
        suspensionReason: null,
      });
      expect(target.status).toBe('ACTIVE');
    });

    it('refuse un compte CLOSED (422) et un compte déjà actif (409)', async () => {
      const closed = adminDb.addUser({ status: 'CLOSED' });
      await post(`/admin/users/${closed.id}/reactivate`).expect(422);
      expect(closed.status).toBe('CLOSED');
      await post(`/admin/users/${user.id}/reactivate`).expect(409);
    });

    it('ADMIN ne peut pas réactiver un SUPER_ADMIN suspendu ; SUPER_ADMIN le peut (pas soi-même)', async () => {
      const otherSuper = adminDb.addUser({
        role: 'SUPER_ADMIN',
        status: 'SUSPENDED',
      });
      await post(`/admin/users/${otherSuper.id}/reactivate`).expect(403);
      expect(otherSuper.status).toBe('SUSPENDED');
      await post(`/admin/users/${otherSuper.id}/reactivate`, superAdmin).expect(
        200,
      );
      expect(otherSuper.status).toBe('ACTIVE');
    });

    it('404 si inconnu ; 403 pour soi-même', async () => {
      await post(`/admin/users/${randomUUID()}/reactivate`).expect(404);
      await post(`/admin/users/${admin.id}/reactivate`).expect(403);
    });
  });
});
