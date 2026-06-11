import { matchRequestedFields } from "./semantic-matching.mjs"

const SCHEMA_VERSION = "memact.task_context_packet.v0"
const FORBIDDEN_CONTEXT = ["full_profile", "raw_capture_events", "unapproved_memory"]
const ALLOWED_PURPOSES = new Set(["onboarding_prefill", "field_mapping", "context_conversion"])
const BLOCKED_FIELD_PATTERNS = [/full[_-]?profile/i, /raw[_-]?capture/i, /raw[_-]?event/i]
const DEFAULT_ALLOWED_ACTOR_TYPES = ["memact_worker"]

function normalize(value, maxLength = 0) {
  const text = String(value || "").replace(/\s+/g, " ").trim()
  if (!text) return ""
  return maxLength && text.length > maxLength ? `${text.slice(0, maxLength - 3).trim()}...` : text
}

function nowIso() {
  return new Date().toISOString()
}

function packetId(targetAppId, connectionId) {
  return `tcp:${slug(targetAppId)}:${slug(connectionId)}:${Date.now()}`
}

function slug(value) {
  return normalize(value, 160).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "packet"
}

function memoryValue(memory) {
  if (memory.value !== undefined) return memory.value
  if (memory.attributes?.value !== undefined) return memory.attributes.value
  if (memory.summary) return memory.summary
  return memory.label || ""
}

function memorySource(memory) {
  return normalize(
    memory.source ||
    memory.source_app_id ||
    memory.provenance?.app_id ||
    memory.provenance?.system ||
    "accepted_memory",
    120
  )
}

function isApproved(memory) {
  const status = normalize(memory.status || memory.state || "accepted").toLowerCase()
  return ["accepted", "active", "edited", "user_verified"].includes(status)
}

function isAllowedForApp(memory, targetAppId) {
  const allowedApps = Array.isArray(memory.allowed_app_ids) ? memory.allowed_app_ids : []
  return !allowedApps.length || allowedApps.includes(targetAppId)
}

function isAllowedActor(memory, actorType) {
  const allowedActors = Array.isArray(memory.allowed_actor_types) ? memory.allowed_actor_types : DEFAULT_ALLOWED_ACTOR_TYPES
  return allowedActors.includes(actorType)
}

function isExplicitlySensitiveAllowed(memory, options = {}) {
  if (normalize(memory.sensitivity).toLowerCase() !== "sensitive") return true
  const allowed = new Set(options.allowedSensitiveFieldPaths || [])
  return allowed.has(memory.field_path)
}

function isRawOrFullProfile(memory) {
  const fieldPath = normalize(memory.field_path || memory.path)
  const type = normalize(memory.type || memory.memory_type).toLowerCase()
  const source = memorySource(memory).toLowerCase()
  return BLOCKED_FIELD_PATTERNS.some((pattern) => pattern.test(fieldPath) || pattern.test(type) || pattern.test(source))
}

function normalizeMemoryRecord(memory = {}) {
  const fieldPath = normalize(memory.field_path || memory.path || memory.attributes?.field_path)
  const category = normalize(memory.category || memory.attributes?.category || "general")
  return {
    ...memory,
    field_path: fieldPath,
    category,
    status: normalize(memory.status || memory.state || "accepted").toLowerCase(),
    sensitivity: normalize(memory.sensitivity || memory.attributes?.sensitivity || "normal").toLowerCase(),
    source_app_id: normalize(memory.source_app_id || memory.provenance?.app_id),
    allowed_app_ids: Array.isArray(memory.allowed_app_ids) ? memory.allowed_app_ids : [],
    allowed_actor_types: Array.isArray(memory.allowed_actor_types) ? memory.allowed_actor_types : DEFAULT_ALLOWED_ACTOR_TYPES,
  }
}

export function filterApprovedTaskMemory(memoryRecords = [], request = {}) {
  const actorType = request.actor?.type || "memact_worker"
  const targetAppId = normalize(request.target_app_id)
  const requestedCategories = new Set((request.categories || []).map((category) => normalize(category).toLowerCase()).filter(Boolean))
  return (Array.isArray(memoryRecords) ? memoryRecords : [])
    .map(normalizeMemoryRecord)
    .filter((memory) => memory.field_path)
    .filter(isApproved)
    .filter((memory) => !requestedCategories.size || requestedCategories.has(memory.category.toLowerCase()))
    .filter((memory) => isAllowedForApp(memory, targetAppId))
    .filter((memory) => isAllowedActor(memory, actorType))
    .filter((memory) => isExplicitlySensitiveAllowed(memory, request))
    .filter((memory) => !isRawOrFullProfile(memory))
}

export function buildTaskContextPacket({
  target_app_id,
  connection_id,
  requested_fields = [],
  field_descriptions = [],
  approved_memory_records = [],
  purpose = "field_mapping",
  actor = { type: "memact_worker", id: "worker:template-context" },
  categories = [],
  allowedSensitiveFieldPaths = [],
  requires_user_review = true,
  created_at = nowIso()
} = {}) {
  if (!target_app_id || !connection_id) {
    throw new TypeError("target_app_id and connection_id are required.")
  }
  if (!ALLOWED_PURPOSES.has(purpose)) {
    throw new TypeError(`Unsupported task context purpose: ${purpose}`)
  }

  const request = { target_app_id, categories, actor, allowedSensitiveFieldPaths }
  const approved = filterApprovedTaskMemory(approved_memory_records, request)
  const requested = [...requested_fields, ...field_descriptions].filter(Boolean)
  const matched = requested.length
    ? matchRequestedFields(requested, approved).flatMap((result) => result.matches.map((match) => match.memory))
    : approved
  const byField = new Map()
  for (const memory of matched) {
    if (!byField.has(memory.field_path)) byField.set(memory.field_path, memory)
  }

  const allowed_context = [...byField.values()].map((memory) => ({
    field_path: memory.field_path,
    value: memoryValue(memory),
    category: memory.category,
    sensitivity: memory.sensitivity || "normal",
    source: memorySource(memory)
  }))

  const packet = {
    schema_version: SCHEMA_VERSION,
    packet_id: packetId(target_app_id, connection_id),
    actor,
    purpose,
    target_app_id,
    connection_id,
    allowed_context,
    forbidden_context: FORBIDDEN_CONTEXT,
    retention: "none",
    requires_user_review,
    created_at
  }
  const validation = validateTaskContextPacketShape(packet)
  if (!validation.ok) {
    const message = validation.errors.map((error) => `${error.path}: ${error.message}`).join("; ")
    throw new TypeError(`Invalid task context packet: ${message}`)
  }
  return packet
}

export function validateTaskContextPacketShape(packet = {}) {
  const errors = []
  const required = ["schema_version", "packet_id", "actor", "purpose", "target_app_id", "connection_id", "allowed_context", "forbidden_context", "retention", "requires_user_review", "created_at"]
  for (const key of required) {
    if (packet[key] === undefined || packet[key] === null || packet[key] === "") errors.push({ path: key, message: "Required field is missing." })
  }
  if (packet.schema_version !== SCHEMA_VERSION) errors.push({ path: "schema_version", message: `Must be ${SCHEMA_VERSION}.` })
  if (packet.actor?.type !== "memact_worker") errors.push({ path: "actor.type", message: "Must be memact_worker." })
  if (!packet.actor?.id) errors.push({ path: "actor.id", message: "Required field is missing." })
  if (!ALLOWED_PURPOSES.has(packet.purpose)) errors.push({ path: "purpose", message: "Unsupported purpose." })
  if (!Array.isArray(packet.allowed_context)) errors.push({ path: "allowed_context", message: "Expected array." })
  if (!Array.isArray(packet.forbidden_context)) errors.push({ path: "forbidden_context", message: "Expected array." })
  if (Array.isArray(packet.forbidden_context)) {
    for (const item of FORBIDDEN_CONTEXT) {
      if (!packet.forbidden_context.includes(item)) errors.push({ path: "forbidden_context", message: `Must include ${item}.` })
    }
  }
  if (packet.retention !== "none") errors.push({ path: "retention", message: "Must be none." })
  if (packet.requires_user_review !== true && packet.requires_user_review !== false) errors.push({ path: "requires_user_review", message: "Expected boolean." })
  return errors.length ? { ok: false, errors } : { ok: true, value: packet }
}

