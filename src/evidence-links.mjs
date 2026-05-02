import {
  normalizeEvidenceLink,
  validateEvidenceLink,
} from "./core-schemas.mjs";

function normalize(value, maxLength = 0) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return maxLength && text.length > maxLength
    ? `${text.slice(0, maxLength - 3).trim()}...`
    : text;
}

function unique(values = []) {
  return [...new Set(values.map((value) => normalize(value)).filter(Boolean))];
}

export function createEvidenceLink(input = {}) {
  const link = normalizeEvidenceLink(input);
  const result = validateEvidenceLink(link);
  if (!result.ok) {
    return {
      ok: false,
      evidence: null,
      errors: result.errors,
    };
  }
  return {
    ok: true,
    evidence: result.value,
    errors: [],
  };
}

export function evidenceFromSource(source = {}, claimSupported = "", options = {}) {
  return createEvidenceLink({
    evidence_id: options.evidence_id,
    packet_id: options.packet_id || source.packet_id,
    unit_id: options.unit_id || source.unit_id,
    source_url: source.url,
    timestamp: source.occurred_at || source.timestamp || options.timestamp,
    snippet: source.snippet || source.text || source.title || source.domain,
    claim_supported: claimSupported,
    score: options.score ?? source.score ?? source.confidence ?? 0.5,
    evidence_type: options.evidence_type || source.evidence_type || "captured_activity",
    metadata: {
      domain: source.domain || "",
      title: source.title || "",
      application: source.application || "",
      ...(options.metadata || {}),
    },
  });
}

export function collectEvidenceLinksFromMemory(memoryStore = {}, claimId = "") {
  const output = [];
  const seen = new Set();
  const claim = normalize(claimId);

  for (const memory of Array.isArray(memoryStore.memories) ? memoryStore.memories : []) {
    for (const source of Array.isArray(memory.sources) ? memory.sources : []) {
      const created = evidenceFromSource(source, claim || memory.id, {
        packet_id: memory.source_packet_id || memory.schema_packet_id,
        score: memory.retrieval_score ?? memory.strength,
        evidence_type: memory.type === "cognitive_schema_memory" ? "schema_memory" : "captured_activity",
        metadata: {
          memory_id: memory.id,
          memory_type: memory.type,
          label: memory.label,
        },
      });
      if (!created.ok) continue;
      if (seen.has(created.evidence.evidence_id)) continue;
      seen.add(created.evidence.evidence_id);
      output.push(created.evidence);
    }

    for (const packetId of Array.isArray(memory.evidence_packet_ids) ? memory.evidence_packet_ids : []) {
      const created = createEvidenceLink({
        packet_id: packetId,
        snippet: memory.summary || memory.label,
        claim_supported: claim || memory.id,
        score: memory.strength,
        evidence_type: "schema_packet",
        metadata: {
          memory_id: memory.id,
          memory_type: memory.type,
        },
      });
      if (!created.ok) continue;
      if (seen.has(created.evidence.evidence_id)) continue;
      seen.add(created.evidence.evidence_id);
      output.push(created.evidence);
    }
  }

  return output;
}

export function indexEvidenceLinks(evidenceLinks = []) {
  return new Map(
    (Array.isArray(evidenceLinks) ? evidenceLinks : [])
      .map((link) => createEvidenceLink(link))
      .filter((result) => result.ok)
      .map((result) => [result.evidence.evidence_id, result.evidence])
  );
}

export function evidenceLinksForClaim(claimId, evidenceLinks = []) {
  const claim = normalize(claimId);
  if (!claim) return [];
  return (Array.isArray(evidenceLinks) ? evidenceLinks : [])
    .map((link) => createEvidenceLink(link))
    .filter((result) => result.ok && result.evidence.claim_supported === claim)
    .map((result) => result.evidence)
    .sort((left, right) => right.score - left.score || left.evidence_id.localeCompare(right.evidence_id));
}

export function attachEvidenceToClaim(claim = {}, evidenceLinks = []) {
  const claimId = normalize(claim.claim_id || claim.id);
  const supporting = evidenceLinksForClaim(claimId, evidenceLinks);
  return {
    ...claim,
    claim_id: claimId || claim.claim_id,
    supporting_evidence_ids: unique([
      ...(claim.supporting_evidence_ids || []),
      ...supporting.map((link) => link.evidence_id),
    ]),
    evidence_links: supporting,
  };
}
