import { validateTaskContextPacketShape } from "./task-context-packet.mjs"

export class TemplateContextWorker {
  constructor({ worker_id = "worker:template-context" } = {}) {
    this.worker_id = worker_id
    this.kind = "template"
  }

  async run(packet) {
    const isCapPacket = packet?.schema_version === "memact.cap_packet.v0"
    const validation = isCapPacket ? validateCapPacketShape(packet) : validateTaskContextPacketShape(packet)
    if (!validation.ok) {
      return {
        status: "error",
        worker_id: this.worker_id,
        errors: validation.errors,
        generated_at: new Date().toISOString()
      }
    }

    return {
      status: "ok",
      worker_id: this.worker_id,
      purpose: packet.purpose,
      target_app_id: packet.target_app_id || packet.app_id,
      connection_id: packet.connection_id,
      output: buildTemplateOutput(packet),
      safety: {
        memory_blind: true,
        received_full_profile: false,
        retention: packet.retention,
        forbidden_context: packet.forbidden_context
      },
      generated_at: new Date().toISOString()
    }
  }
}

export class MockContextWorker extends TemplateContextWorker {}

export function createContextWorker(options = {}) {
  return new TemplateContextWorker(options)
}

function buildTemplateOutput(packet) {
  if (packet.purpose === "onboarding_prefill") {
    return {
      fields: Object.fromEntries(packet.allowed_context.map((item) => [item.field_path, item.value])),
      requires_user_review: packet.requires_user_review,
      note: "Prefill uses only approved memory fragments from this packet."
    }
  }
  if (packet.purpose === "field_mapping") {
    return {
      mappings: packet.allowed_context.map((item) => ({
        app_field: item.field_path,
        memact_field: item.field_path,
        value: item.value,
        category: item.category,
        source: item.source
      }))
    }
  }
  return {
    entries: packet.allowed_context.map((item) => ({
      title: item.field_path,
      value: item.value,
      category: item.category,
      needs_review: packet.requires_user_review
    }))
  }
}

function validateCapPacketShape(packet = {}) {
  const errors = []
  const required = ["schema_version", "packet_id", "request_id", "app_id", "connection_id", "purpose", "allowed_context", "missing_context", "forbidden_context", "retention", "requires_user_review", "created_at"]
  for (const key of required) {
    if (packet[key] === undefined || packet[key] === null || packet[key] === "") errors.push({ path: key, message: "Required field is missing." })
  }
  if (packet.schema_version !== "memact.cap_packet.v0") errors.push({ path: "schema_version", message: "Must be memact.cap_packet.v0." })
  if (!Array.isArray(packet.allowed_context)) errors.push({ path: "allowed_context", message: "Expected array." })
  if (!Array.isArray(packet.missing_context)) errors.push({ path: "missing_context", message: "Expected array." })
  if (!Array.isArray(packet.forbidden_context)) errors.push({ path: "forbidden_context", message: "Expected array." })
  for (const item of ["full_profile", "raw_capture_events", "unapproved_memory"]) {
    if (Array.isArray(packet.forbidden_context) && !packet.forbidden_context.includes(item)) {
      errors.push({ path: "forbidden_context", message: `Must include ${item}.` })
    }
  }
  if (packet.retention !== "none") errors.push({ path: "retention", message: "Must be none." })
  return errors.length ? { ok: false, errors } : { ok: true, value: packet }
}
