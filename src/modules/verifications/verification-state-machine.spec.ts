import { BadRequestException } from '@nestjs/common';
import {
  IdentityVerificationStatus as I,
  JobberStatus as J,
  VerificationCaseStatus as C,
} from '@prisma/client';
import {
  CASE_TRANSITIONS,
  IDENTITY_TRANSITIONS,
  JOBBER_TRANSITIONS,
  assertCaseTransition,
  assertIdentityTransition,
  assertJobberTransition,
  canTransitionCase,
  canTransitionIdentity,
  canTransitionJobber,
} from './verification-state-machine';

describe('verification state machine', () => {
  it('defines an entry for every enum value', () => {
    for (const s of Object.values(I))
      expect(IDENTITY_TRANSITIONS[s]).toBeDefined();
    for (const s of Object.values(J))
      expect(JOBBER_TRANSITIONS[s]).toBeDefined();
    for (const s of Object.values(C)) expect(CASE_TRANSITIONS[s]).toBeDefined();
  });

  describe('identity', () => {
    it.each([
      [I.UNVERIFIED, I.PENDING],
      [I.PENDING, I.VERIFIED],
      [I.PENDING, I.NEEDS_CHANGES],
      [I.PENDING, I.REJECTED],
      [I.NEEDS_CHANGES, I.PENDING],
    ])('allows %s -> %s', (from, to) => {
      expect(canTransitionIdentity(from, to)).toBe(true);
      expect(() => assertIdentityTransition(from, to)).not.toThrow();
    });

    it.each([
      [I.UNVERIFIED, I.VERIFIED],
      [I.UNVERIFIED, I.REJECTED],
      [I.NEEDS_CHANGES, I.VERIFIED],
      [I.VERIFIED, I.PENDING],
      [I.REJECTED, I.VERIFIED],
      [I.REJECTED, I.PENDING],
      [I.PENDING, I.PENDING],
    ])('forbids %s -> %s with BadRequestException', (from, to) => {
      expect(canTransitionIdentity(from, to)).toBe(false);
      expect(() => assertIdentityTransition(from, to)).toThrow(
        BadRequestException,
      );
    });
  });

  describe('jobber', () => {
    it.each([
      [J.DRAFT, J.PENDING_VERIFICATION],
      [J.PENDING_VERIFICATION, J.ACTIVE],
      [J.PENDING_VERIFICATION, J.NEEDS_CHANGES],
      [J.PENDING_VERIFICATION, J.REJECTED],
      [J.NEEDS_CHANGES, J.PENDING_VERIFICATION],
    ])('allows %s -> %s', (from, to) => {
      expect(canTransitionJobber(from, to)).toBe(true);
      expect(() => assertJobberTransition(from, to)).not.toThrow();
    });

    it.each([
      [J.DRAFT, J.ACTIVE],
      [J.NEEDS_CHANGES, J.ACTIVE],
      [J.REJECTED, J.ACTIVE],
      [J.ACTIVE, J.PENDING_VERIFICATION],
      [J.SUSPENDED, J.ACTIVE],
    ])('forbids %s -> %s with BadRequestException', (from, to) => {
      expect(canTransitionJobber(from, to)).toBe(false);
      expect(() => assertJobberTransition(from, to)).toThrow(
        BadRequestException,
      );
    });
  });

  describe('verification case', () => {
    it.each([
      [C.DRAFT, C.PENDING],
      [C.PENDING, C.APPROVED],
      [C.PENDING, C.NEEDS_CHANGES],
      [C.PENDING, C.REJECTED],
      [C.NEEDS_CHANGES, C.PENDING],
    ])('allows %s -> %s', (from, to) => {
      expect(canTransitionCase(from, to)).toBe(true);
      expect(() => assertCaseTransition(from, to)).not.toThrow();
    });

    it.each([
      [C.DRAFT, C.APPROVED],
      [C.APPROVED, C.APPROVED],
      [C.APPROVED, C.REJECTED],
      [C.REJECTED, C.APPROVED],
      [C.NEEDS_CHANGES, C.APPROVED],
    ])('forbids %s -> %s with BadRequestException', (from, to) => {
      expect(canTransitionCase(from, to)).toBe(false);
      expect(() => assertCaseTransition(from, to)).toThrow(BadRequestException);
    });
  });
});
