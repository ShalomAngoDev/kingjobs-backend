import { computeStaffing } from './mission-staffing';

describe('computeStaffing', () => {
  it('computes remaining places', () => {
    expect(computeStaffing(10, 6)).toEqual({
      workersNeeded: 10,
      filledWorkers: 6,
      remainingWorkers: 4,
      isFull: false,
    });
  });

  it('marks full when filled equals needed', () => {
    expect(computeStaffing(1, 1)).toEqual({
      workersNeeded: 1,
      filledWorkers: 1,
      remainingWorkers: 0,
      isFull: true,
    });
  });

  it('never returns negative remaining', () => {
    expect(computeStaffing(2, 5).remainingWorkers).toBe(0);
    expect(computeStaffing(2, 5).isFull).toBe(true);
  });

  it('clamps workersNeeded to at least 1', () => {
    expect(computeStaffing(0, 0).workersNeeded).toBe(1);
    expect(computeStaffing(-3, 0).workersNeeded).toBe(1);
  });

  it('treats empty mission as not full', () => {
    expect(computeStaffing(10, 0)).toEqual({
      workersNeeded: 10,
      filledWorkers: 0,
      remainingWorkers: 10,
      isFull: false,
    });
  });
});
