import { validateTaskContextPacketShape } from "./task-context-packet.mjs"

export class TemplateContextWorker {
  constructor({ worker_id = "worker:template-context" } = {}) {
    this.worker_id = worker_id
    this.kind = "template"
  }

  async run(packet) {
    const validation = validateTaskContextPacketShape(packet)
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
      target_app_id: packet.target_app_id,
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

