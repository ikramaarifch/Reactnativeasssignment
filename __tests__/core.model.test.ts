import { createReport, ReportValidationError, validateReportInput } from '../src/core/report';
import { assertTransition, canTransition, IllegalTransitionError } from '../src/core/stateMachine';
import { ReportStatus } from '../src/core/types';

describe('report validation', () => {
  const img = (n: number) => Array.from({ length: n }, (_, i) => `file:///${i}.jpg`);

  it.each(['', '   ', '\n\t'])('blocks a blank description %j', description => {
    expect(validateReportInput({ description, imageUris: img(1) })).toEqual([
      expect.objectContaining({ field: 'description', code: 'blank' }),
    ]);
  });

  it('blocks zero images and a sixth image', () => {
    expect(validateReportInput({ description: 'x', imageUris: [] })[0]).toMatchObject({ code: 'none' });
    expect(validateReportInput({ description: 'x', imageUris: img(6) })[0]).toMatchObject({
      code: 'too_many',
    });
    expect(validateReportInput({ description: 'x', imageUris: img(5) })).toEqual([]);
  });

  it('createReport throws on invalid input and trims the description', () => {
    expect(() => createReport({ description: ' ', imageUris: [] }, 'id', 1)).toThrow(
      ReportValidationError,
    );
    expect(createReport({ description: '  ok  ', imageUris: img(1) }, 'id', 1).description).toBe('ok');
  });
});

describe('state machine', () => {
  it('allows the happy path and rejects shortcuts', () => {
    const path: ReportStatus[] = ['saved_locally', 'preparing', 'uploading', 'finalizing', 'uploaded'];
    for (let i = 0; i < path.length - 1; i++) {
      expect(canTransition(path[i]!, path[i + 1]!)).toBe(true);
    }
    expect(canTransition('saved_locally', 'uploaded')).toBe(false);
    expect(canTransition('uploading', 'uploaded')).toBe(false); // must pass through finalizing
    expect(() => assertTransition('uploaded', 'saved_locally')).toThrow(IllegalTransitionError);
  });

  it('failed_permanent only leaves through a manual retry', () => {
    expect(canTransition('failed_permanent', 'saved_locally')).toBe(true);
    expect(canTransition('failed_permanent', 'uploading')).toBe(false);
  });
});
