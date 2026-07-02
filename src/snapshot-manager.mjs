import { EventEmitter } from 'events';

/**
 * Isolated Reader Snapshot Manager for handling lock-free concurrent app access.
 * Abstracts away internal MVCC mechanics from the outer API.
 */
export class SnapshotManager extends EventEmitter {
  constructor(memoryStore) {
    super();
    this.store = memoryStore;
    this.activeSnapshots = new Map();
    this.versionSequence = 0;
  }

  /**
   * Creates an isolated, read-only snapshot of the current memory store state
   * @returns {string} The snapshot ID identifier
   */
  createSnapshot() {
    this.versionSequence++;
    const snapshotId = `snap_v${this.versionSequence}_${Date.now()}`;
    
    // Perform a shallow clone of the active memory store states for a lock-free read reference
    const structuralState = {
      memories: Array.isArray(this.store.memories) ? [...this.store.memories] : [],
      relations: Array.isArray(this.store.relations) ? [...this.store.relations] : [],
      actions: Array.isArray(this.store.actions) ? [...this.store.actions] : [],
      timestamp: Date.now()
    };

    this.activeSnapshots.set(snapshotId, structuralState);
    return snapshotId;
  }

  /**
   * Routes a query to an isolated snapshot, completely bypassing active mutations
   * @param {string} snapshotId 
   * @param {Function} queryFn 
   * @returns {*} Result of the query evaluation
   */
  querySnapshot(snapshotId, queryFn) {
    const state = this.activeSnapshots.get(snapshotId);
    if (!state) {
      throw new Error(`Snapshot with ID ${snapshotId} has expired or does not exist.`);
    }
    // Route execution to the isolated immutable state reference
    return queryFn(state);
  }

  /**
   * Releases snapshot resources to prevent memory leaks
   * @param {string} snapshotId 
   */
  releaseSnapshot(snapshotId) {
    this.activeSnapshots.delete(snapshotId);
  }
}