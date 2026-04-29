import { readFile, writeFile } from "node:fs/promises";
import {
  createMemory,
  deleteMemory,
  listMemories,
  readMemory,
  updateMemory,
} from "./engine.mjs";

const EMPTY_STORE = {
  schema_version: "memact.memory.v0",
  memories: [],
  actions: [],
};

function normalizePath(value) {
  return String(value || "").trim();
}

export function createMemoryRepository(adapter) {
  if (!adapter || typeof adapter.load !== "function" || typeof adapter.save !== "function") {
    throw new TypeError("Memory repository requires an adapter with load() and save(store).");
  }

  return {
    async load() {
      return (await adapter.load()) || EMPTY_STORE;
    },
    async save(memoryStore) {
      await adapter.save(memoryStore || EMPTY_STORE);
      return memoryStore || EMPTY_STORE;
    },
    async create(memoryInput) {
      const current = await this.load();
      const result = createMemory(memoryInput, current);
      await this.save(result.memoryStore);
      return result;
    },
    async read(memoryId) {
      return readMemory(memoryId, await this.load());
    },
    async list(filters = {}) {
      return listMemories(await this.load(), filters);
    },
    async update(memoryId, patch = {}) {
      const current = await this.load();
      const result = updateMemory(memoryId, patch, current);
      await this.save(result.memoryStore);
      return result;
    },
    async delete(memoryId, options = {}) {
      const current = await this.load();
      const result = deleteMemory(memoryId, current, options);
      await this.save(result.memoryStore);
      return result;
    },
  };
}

export function createJsonFileMemoryAdapter(filePath) {
  const path = normalizePath(filePath);
  if (!path) {
    throw new TypeError("JSON memory adapter requires a file path.");
  }

  return {
    kind: "json_file",
    async load() {
      try {
        return JSON.parse(await readFile(path, "utf8"));
      } catch (error) {
        if (error?.code === "ENOENT") {
          return EMPTY_STORE;
        }
        throw error;
      }
    },
    async save(memoryStore) {
      await writeFile(path, `${JSON.stringify(memoryStore || EMPTY_STORE, null, 2)}\n`, "utf8");
    },
  };
}

export function createRemoteMemoryAdapter({ load, save, provider = "remote", description = "" } = {}) {
  if (typeof load !== "function" || typeof save !== "function") {
    throw new TypeError("Remote memory adapter requires load() and save() functions.");
  }

  return {
    kind: provider,
    description,
    async load() {
      return (await load()) || EMPTY_STORE;
    },
    async save(memoryStore) {
      await save(memoryStore || EMPTY_STORE);
    },
  };
}
