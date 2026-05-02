function normalize(value, maxLength = 0) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return maxLength && text.length > maxLength ? `${text.slice(0, maxLength - 3).trim()}...` : text;
}

function slug(value) {
  return normalize(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "timeline";
}

function parseTime(value) {
  const timestamp = Date.parse(value || "");
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function unique(values = []) {
  return [...new Set(values.map((value) => normalize(value)).filter(Boolean))];
}

function timelineEvent(type, input = {}) {
  return {
    id: input.id || `${type}:${slug(`${input.label || type}:${input.occurred_at || ""}`)}`,
    type,
    label: normalize(input.label || type, 240),
    occurred_at: normalize(input.occurred_at, 80),
    evidence_ids: unique(input.evidence_ids || input.evidence_packet_ids),
    score: Number(Number(input.score ?? input.weight ?? 0).toFixed(4)),
    source_type: normalize(input.source_type, 80),
    metadata: input.metadata && typeof input.metadata === "object" ? input.metadata : {},
  };
}

function eventsFromMemoryStore(memoryStore = {}) {
  const memories = Array.isArray(memoryStore.memories) ? memoryStore.memories : [];
  return memories.flatMap((memory) => {
    const evidenceIds = unique(memory.evidence_packet_ids || (memory.source_packet_id ? [memory.source_packet_id] : []));
    const memoryEvent = timelineEvent("digital_exposure", {
      id: `exposure:${memory.id}`,
      label: memory.label,
      occurred_at: memory.first_seen_at || memory.last_seen_at,
      evidence_ids: evidenceIds,
      score: memory.strength,
      metadata: {
        memory_id: memory.id,
        themes: memory.themes || [],
      },
    });
    const sourceEvents = (memory.sources || []).map((source, index) => timelineEvent("digital_exposure", {
      id: `exposure:${memory.id}:source:${index}`,
      label: source.title || source.domain || source.url,
      occurred_at: source.occurred_at || memory.first_seen_at || memory.last_seen_at,
      evidence_ids: evidenceIds,
      score: memory.strength,
      source_type: source.source_type,
      metadata: {
        memory_id: memory.id,
        url: source.url || "",
        domain: source.domain || "",
      },
    }));
    return [memoryEvent, ...sourceEvents].filter((event) => event.occurred_at);
  });
}

function normalizeExposure(input = {}) {
  return timelineEvent("digital_exposure", {
    id: input.id,
    label: input.label || input.title || input.source_label || input.url,
    occurred_at: input.occurred_at || input.timestamp || input.captured_at,
    evidence_ids: input.evidence_ids || (input.evidence_id ? [input.evidence_id] : []),
    score: input.score ?? input.strength,
    source_type: input.source_type,
    metadata: {
      url: input.url || input.source_url || "",
      packet_id: input.packet_id || "",
      unit_id: input.unit_id || "",
    },
  });
}

export function reconstructTemporalInfluencePath({
  thought = "",
  thought_at = new Date().toISOString(),
  exposures = [],
  searches = [],
  memoryStore = {},
} = {}, options = {}) {
  const thoughtTime = parseTime(thought_at);
  const exposureEvents = [
    ...eventsFromMemoryStore(memoryStore),
    ...(Array.isArray(exposures) ? exposures : []).map(normalizeExposure),
  ]
    .filter((event) => event.label && event.occurred_at)
    .filter((event) => !thoughtTime || parseTime(event.occurred_at) <= thoughtTime)
    .sort((left, right) => parseTime(left.occurred_at) - parseTime(right.occurred_at));

  const searchEvents = (Array.isArray(searches) ? searches : [])
    .map((event) => timelineEvent("related_search_or_click", {
      id: event.id,
      label: event.label || event.query || event.title,
      occurred_at: event.occurred_at || event.timestamp,
      evidence_ids: event.evidence_ids || (event.evidence_id ? [event.evidence_id] : []),
      score: event.score,
      source_type: event.source_type || "search_result",
      metadata: { url: event.url || "" },
    }))
    .filter((event) => event.label && event.occurred_at)
    .filter((event) => !thoughtTime || parseTime(event.occurred_at) <= thoughtTime);

  const firstExposure = exposureEvents[0] ? { ...exposureEvents[0], type: "first_exposure" } : null;
  const strongestExposure = exposureEvents.length
    ? { ...[...exposureEvents].sort((left, right) => right.score - left.score || parseTime(right.occurred_at) - parseTime(left.occurred_at))[0], type: "strongest_exposure" }
    : null;
  const repeatedExposure = exposureEvents.length >= Number(options.repetitionThreshold ?? 2)
    ? timelineEvent("repeated_exposures", {
      label: `${exposureEvents.length} related exposures`,
      occurred_at: exposureEvents.at(-1).occurred_at,
      evidence_ids: exposureEvents.flatMap((event) => event.evidence_ids),
      score: Math.min(1, exposureEvents.length / 6),
      metadata: {
        exposure_count: exposureEvents.length,
        exposure_ids: exposureEvents.map((event) => event.id),
      },
    })
    : null;
  const relatedSearch = searchEvents.sort((left, right) => parseTime(left.occurred_at) - parseTime(right.occurred_at))[0] || null;
  const thoughtEvent = timelineEvent("user_entered_thought", {
    label: thought,
    occurred_at: thought_at,
    evidence_ids: [],
    score: 1,
  });
  const timeline = [firstExposure, repeatedExposure, strongestExposure, relatedSearch, thoughtEvent]
    .filter(Boolean)
    .sort((left, right) => parseTime(left.occurred_at) - parseTime(right.occurred_at));

  return {
    schema_version: "memact.temporal_influence_path.v1",
    generated_at: new Date().toISOString(),
    thought: normalize(thought, 600),
    thought_at: normalize(thought_at, 80),
    timeline,
    summary: {
      exposure_count: exposureEvents.length,
      first_exposure_at: firstExposure?.occurred_at || "",
      strongest_exposure_id: strongestExposure?.id || "",
      evidence_ids: unique(timeline.flatMap((event) => event.evidence_ids)),
    },
  };
}
