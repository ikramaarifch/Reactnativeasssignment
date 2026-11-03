import { TransportError } from '../src/transport/UploadTransport';
import { Harness, newReport, reportIs, until } from '../src/testing/harness';

describe('idempotency: lost responses never duplicate', () => {
  it('image stored but response lost -> retry skips re-sending the bytes', async () => {
    const h = new Harness();
    let lost = true;
    h.transport.afterUploadStored = () => {
      if (lost) {
        lost = false;
        throw new TransportError('network'); // server has it, client never heard
      }
    };
    const engine = h.engine();
    await engine.start();
    await engine.enqueue(newReport('r1', 1));
    await until(engine, reportIs('r1', 'uploaded'));

    expect(h.transport.uploadCalls).toEqual(['reports/r1/0.jpg']); // sent exactly once
    expect(h.server.objectWrites.get('reports/r1/0.jpg')).toBe(1);
    expect(h.server.objects.size).toBe(1);
    expect(h.server.docs.size).toBe(1);
    await h.stopAll();
  });

  it('commit stored but response lost -> re-commit overwrites, one document', async () => {
    const h = new Harness();
    let lost = true;
    h.transport.afterCommitStored = () => {
      if (lost) {
        lost = false;
        throw new TransportError('timeout');
      }
    };
    const engine = h.engine();
    await engine.start();
    await engine.enqueue(newReport('r1', 2));
    await until(engine, reportIs('r1', 'uploaded'));

    expect(h.server.docs.size).toBe(1);
    expect(h.transport.commitCalls).toBe(2); // it did retry...
    expect(h.transport.uploadCalls).toHaveLength(2); // ...but images were not re-sent
    expect(h.server.objects.size).toBe(2);
    await h.stopAll();
  });

  it('remote object with the same path but different content IS re-uploaded', async () => {
    const h = new Harness();
    h.server.objects.set('reports/r1/0.jpg', { sizeBytes: 123, md5Base64: 'stale-partial' });
    const engine = h.engine();
    await engine.start();
    await engine.enqueue(newReport('r1', 1));
    await until(engine, reportIs('r1', 'uploaded'));

    expect(h.transport.uploadCalls).toEqual(['reports/r1/0.jpg']);
    expect(h.server.objects.get('reports/r1/0.jpg')?.md5Base64).toBe('md5(file:///docs/r1-0.jpg)');
    await h.stopAll();
  });

  it('the commit marker is never written before every image is confirmed', async () => {
    const h = new Harness();
    let docsWhenSecondImageStarted = -1;
    h.transport.beforeUpload = req => {
      if (req.path.endsWith('/1.jpg')) {
        docsWhenSecondImageStarted = h.server.docs.size;
      }
    };
    const engine = h.engine();
    await engine.start();
    await engine.enqueue(newReport('r1', 2));
    await until(engine, reportIs('r1', 'uploaded'));
    expect(docsWhenSecondImageStarted).toBe(0);
    await h.stopAll();
  });
});

