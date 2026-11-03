import { NoProgressError } from '../src/core/retryPolicy';
import { Scheduler } from '../src/core/scheduler';
import { withWatchdog } from '../src/core/watchdog';
import { Harness, newReport, reportIs, until } from '../src/testing/harness';
import { TransportError } from '../src/transport/UploadTransport';

/** A scheduler and clock the test advances by hand: no real or fake global timers involved. */
class ManualClock implements Scheduler {
  time = 0;
  pending: Array<{ at: number; fn: () => void; cancelled: boolean }> = [];
  scheduled = 0;

  now = (): number => this.time;

  after(ms: number, fn: () => void): () => void {
    const entry = { at: this.time + ms, fn, cancelled: false };
    this.pending.push(entry);
    this.scheduled++;
    return () => {
      entry.cancelled = true;
    };
  }

  /** Moves time forward and fires whatever became due, in order. */
  advance(ms: number): void {
    const target = this.time + ms;
    for (;;) {
      const due = this.pending
        .filter(e => !e.cancelled && e.at <= target)
        .sort((a, b) => a.at - b.at)[0];
      if (!due) {
        break;
      }
      this.pending = this.pending.filter(e => e !== due);
      this.time = due.at;
      due.fn();
    }
    this.time = target;
  }

  get active(): number {
    return this.pending.filter(e => !e.cancelled).length;
  }
}

describe('withWatchdog on an injected scheduler', () => {
  it('cuts a request that never makes progress, exactly after the stall window', async () => {
    const clock = new ManualClock();
    const parent = new AbortController();
    const result = withWatchdog(
      100,
      parent.signal,
      () => new Promise<void>(() => {}),
      clock,
      clock.now,
    );
    const outcome = result.then(
      () => 'resolved',
      e => (e instanceof NoProgressError ? 'no-progress' : 'other'),
    );
    clock.advance(99);
    await Promise.resolve();
    clock.advance(1);
    expect(await outcome).toBe('no-progress');
  });

  it('keeps waiting while bytes move, even far beyond the stall window (2G)', async () => {
    const clock = new ManualClock();
    const parent = new AbortController();
    let finish: () => void = () => {};
    let touch: () => void = () => {};
    const result = withWatchdog(
      100,
      parent.signal,
      (_signal, t) => {
        touch = t;
        return new Promise<void>(resolve => (finish = resolve));
      },
      clock,
      clock.now,
    );
    let settled = false;
    result.then(
      () => (settled = true),
      () => (settled = true),
    );

    for (let i = 0; i < 20; i++) {
      clock.advance(60); // 1200 ms total, 12x the stall window
      touch(); // progress arrives every 60 ms
      await Promise.resolve();
    }
    expect(settled).toBe(false);
    finish();
    await expect(result).resolves.toBeUndefined();
  });

  it('uses ONE pending timer no matter how many progress events arrive', async () => {
    const clock = new ManualClock();
    let touch: () => void = () => {};
    let finish: () => void = () => {};
    const result = withWatchdog(
      1000,
      new AbortController().signal,
      (_s, t) => {
        touch = t;
        return new Promise<void>(resolve => (finish = resolve));
      },
      clock,
      clock.now,
    );
    for (let i = 0; i < 500; i++) {
      touch(); // 500 progress events
    }
    expect(clock.scheduled).toBe(1);
    expect(clock.active).toBe(1);
    finish();
    await result;
    expect(clock.active).toBe(0); // timer cancelled when the request finishes
  });
});

describe('engine retry wake-up goes through the injected scheduler', () => {
  it('schedules the backoff on the scheduler (not setTimeout) and retries when it fires', async () => {
    const clock = new ManualClock();
    const h = new Harness();
    let failing = true;
    h.transport.beforeUpload = () => {
      if (failing) {
        throw new TransportError('network');
      }
    };
    const engine = h.engine({
      scheduler: clock,
      now: clock.now,
      backoff: { baseMs: 10_000, capMs: 10_000 },
      random: () => 0.99,
    });
    await engine.start();
    await engine.enqueue(newReport('r1', 1));
    await until(engine, reportIs('r1', 'failed_retrying'));
    await new Promise(r => setTimeout(r, 20)); // let drain() finish and schedule the wake-up

    expect(clock.active).toBeGreaterThanOrEqual(1);
    const callsBefore = h.transport.uploadCalls.length;

    failing = false;
    clock.advance(20_000); // the backoff elapses on OUR clock
    await until(engine, reportIs('r1', 'uploaded'));
    expect(h.transport.uploadCalls.length).toBeGreaterThan(callsBefore);
    await h.stopAll();
  });

  it('stop() cancels the scheduled wake-up', async () => {
    const clock = new ManualClock();
    const h = new Harness();
    h.transport.beforeUpload = () => {
      throw new TransportError('network');
    };
    const engine = h.engine({
      scheduler: clock,
      now: clock.now,
      backoff: { baseMs: 10_000, capMs: 10_000 },
      random: () => 0.99,
    });
    await engine.start();
    await engine.enqueue(newReport('r1', 1));
    await until(engine, reportIs('r1', 'failed_retrying'));
    await new Promise(r => setTimeout(r, 20));
    await engine.stop();
    expect(clock.active).toBe(0);
  });
});
