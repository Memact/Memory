import assert from 'assert';
import { SnapshotManager } from '../src/snapshot-manager.mjs';

describe('SnapshotManager Concurrency & Race-Condition Tests', () => {
  let mockStore;
  let manager;

  beforeEach(() => {
    mockStore = {
      memories: [{ id: 1, content: 'Initial Context State', category: 'system' }],
      relations: [],
      actions: []
    };
    manager = new SnapshotManager(mockStore);
  });

  it('should maintain an isolated state during concurrent mutations', async () => {
    // 1. Capture read-only snapshot of initial state
    const snapshotId = manager.createSnapshot();

    // 2. Simulate an active concurrent update/mutation to the live store
    mockStore.memories.push({ id: 2, content: 'Incoming Concurrent Structural Interruption', category: 'user' });
    mockStore.memories[0].content = 'MUTATED_LIVE_DATA';

    // 3. Query the snapshot and verify total isolation (Lock-free routing check)
    const snapshotData = manager.querySnapshot(snapshotId, (state) => state.memories);

    // Assertions ensuring structural updates did not leak into our isolated snapshot view
    assert.strictEqual(snapshotData.length, 1);
    assert.strictEqual(snapshotData[0].content, 'Initial Context State');
    
    // Clean up
    manager.releaseSnapshot(snapshotId);
  });
});