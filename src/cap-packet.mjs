import { matchRequestedFields } from "./semantic-matching.mjs"
import { filterApprovedTaskMemory } from "./task-context-packet.mjs"

const SCHEMA_VERSION = "memact.cap_packet.v0"
export const CAP_FORBIDDEN_CONTEXT = ["full_profile", "raw_capture_events", "unapproved_memory"]

function normalize(value, maxLength = 0) {
  const text = String(value || "").replace(/\s+/g, " ").trim()
  if (!text) return ""
  return maxLength && text.length > maxLength ? `${text.slice(0, maxLength - 3).trim()}...` : text
}

function slug(value) {
  return normalize(value, 160).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "cap"
}

function nowIso() {
  return new Date().toISOString()
}

function capPacketId(requestId, appId) {
  return `cap_pkt:${slug(appId)}:${slug(requestId)}:${Date.now()}`
}

function memoryValue(memory) {
  if (memory.value !== undefined) return memory.value
  if (memory.attributes?.value !== undefined) return memory.attributes.value
  if (memory.context?.value !== undefined) return memory.context.value
  if (memory.summary) return memory.summary
  return memory.label || ""
}

function memorySource(memory) {
  return normalize(
    memory.source ||
    memory.source_app_id ||
    memory.provenance?.app_id ||
    memory.provenance?.system ||
    "approved_memory",
    120
  )
}

function normalizeRequestedItem(item = {}) {
  if (typeof item === "string") {
    return { description: item, required: false }
  }
  return {
    description: normalize(item.description || item.field_hint || item.name),
    field_hint: normalize(item.field_hint),
    category_hint: normalize(item.category_hint),
    required: Boolean(item.required)
  }
}

function itemText(item) {
  return [item.description, item.field_hint, item.category_hint].filter(Boolean).join(" ")
}

export function retrieveApprovedContextFields(memoryRecords = [], capRequest = {}, options = {}) {
  const requestedCategories = capRequest.requested_categories || options.categories || []
  const approved = filterApprovedTaskMemory(memoryRecords, {
    target_app_id: capRequest.app_id,
    categories: requestedCategories,
    actor: { type: "memact_worker" },
    allowedSensitiveFieldPaths: options.allowedSensitiveFieldPaths || []
  })
  return approved
}

export function buildCapPacket({
  cap_request,
  approved_memory_records = [],
  allowedSensitiveFieldPaths = [],
  requires_user_review = true,
  created_at = nowIso()
} = {}) {
  if (!cap_request || typeof cap_request !== "object") {
    throw new TypeError("cap_request is required.")
  }
  const requested = (Array.isArray(cap_request.requested_context) ? cap_request.requested_context : [])
    .map(normalizeRequestedItem)
    .filter((item) => item.description)
  if (!cap_request.request_id || !cap_request.app_id || !cap_request.connection_id || !cap_request.purpose) {
    throw new TypeError("cap_request must include request_id, app_id, connection_id, and purpose.")
  }

  const approved = retrieveApprovedContextFields(approved_memory_records, cap_request, { allowedSensitiveFieldPaths })
  const matchesByRequest = matchRequestedFields(requested.map(itemText), approved, { threshold: 0.12 })
  const allowedByField = new Map()
  const missing_context = []

  requested.forEach((item, index) => {
    const matches = matchesByRequest[index]?.matches || []
    const best = matches[0]
    if (!best) {
      missing_context.push({
        description: item.description,
        field_hint: item.field_hint || undefined,
        category_hint: item.category_hint || undefined,
        required: item.required,
        reason: "No approved matching memory."
      })
      return
    }
    const memory = best.memory
    if (!allowedByField.has(memory.field_path)) allowedByField.set(memory.field_path, { memory, score: best.score })
  })

  const allowed_context = [...allowedByField.values()].map(({ memory, score }) => ({
    field_path: memory.field_path,
    value: memoryValue(memory),
    category: memory.category || "general",
    sensitivity: memory.sensitivity || "normal",
    source: memorySource(memory),
    confidence: memory.confidence !== undefined ? Number(memory.confidence) : Number(score.toFixed(3))
  }))

  return {
    schema_version: SCHEMA_VERSION,
    packet_id: capPacketId(cap_request.request_id, cap_request.app_id),
    request_id: cap_request.request_id,
    app_id: cap_request.app_id,
    connection_id: cap_request.connection_id,
    purpose: cap_request.purpose,
    allowed_context,
    missing_context,
    forbidden_context: CAP_FORBIDDEN_CONTEXT,
    retention: "none",
    requires_user_review: Boolean(requires_user_review || missing_context.some((item) => item.required)),
    created_at
  }
}
