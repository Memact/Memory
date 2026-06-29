function normalize(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9.]+/g, " ").trim()
}

function tokens(value) {
  return new Set(normalize(value).split(/\s+/).filter((token) => token.length >= 3))
}

function tokenOverlap(aTokens, bTokens) {
  if (!aTokens?.size || !bTokens?.size) return 0
  let overlap = 0
  for (const token of aTokens) if (bTokens.has(token)) overlap += 1
  return overlap
}

const FIELD_SYNONYMS = {
  "food restrictions": ["diet.preference", "diet.allergy", "diet.restriction", "nutrition.allergy"],
  "diet restrictions": ["diet.preference", "diet.allergy", "diet.restriction", "nutrition.allergy"],
  "fitness goal": ["fitness.goal", "fitness.training_goal", "health.goal"],
  "preferred username": ["profile.username", "identity.preferred_username"],
  "email": ["profile.email", "identity.email"]
}

export const semanticMatchingExamples = [
  {
    app_field: "food restrictions",
    memact_fields: ["diet.preference", "diet.allergy"],
    reason: "Food restriction onboarding can use accepted diet preference and allergy memory."
  }
]

function memoryFieldPath(memory = {}) {
  return normalize(memory.field_path || memory.path || "")
}

function memorySearchableText(memory = {}) {
  const fieldPath = memory.field_path || memory.path || ""
  const valueText = memory.value === undefined ? "" : typeof memory.value === "string" ? memory.value : JSON.stringify(memory.value)
  return [
    fieldPath,
    memory.category,
    memory.label,
    memory.summary,
    valueText,
    ...(memory.themes || [])
  ].join(" ")
}

function lexicalScoreForRequestedField(requestedText, memory) {
  const requestedTokens = tokens(requestedText)
  if (!requestedTokens.size) return 0
  const candidateTokens = tokens(memorySearchableText(memory))
  const overlap = tokenOverlap(requestedTokens, candidateTokens)
  return requestedTokens.size ? overlap / requestedTokens.size : 0
}

function buildFieldGraph(memoryRecords = []) {
  // Nodes are memory field_paths present in memoryRecords.
  // Edges connect fields likely to be related, based on cheap heuristics.
  const fields = []
  const byFieldPath = new Map()

  for (const memory of memoryRecords) {
    const fieldPath = memory.field_path || memory.path || ""
    if (!fieldPath) continue
    const normalizedPath = normalize(fieldPath)
    if (!byFieldPath.has(normalizedPath)) {
      fields.push(normalizedPath)
      byFieldPath.set(normalizedPath, { field_path: fieldPath })
    }
  }

  // Pre-tokenize searchable text per field to speed up graph building + traversal scoring.
  const fieldTokens = new Map()
  const fieldCategories = new Map()
  for (const memory of memoryRecords) {
    const normalizedPath = memoryFieldPath(memory)
    if (!normalizedPath || !byFieldPath.has(normalizedPath)) continue
    if (!fieldTokens.has(normalizedPath)) fieldTokens.set(normalizedPath, tokens(memorySearchableText(memory)))
    if (!fieldCategories.has(normalizedPath)) fieldCategories.set(normalizedPath, normalize(memory.category || ""))
  }

  // Build adjacency list with weights.
  const adjacency = new Map() // from -> [{to, weight, reason}]
  const addEdge = (from, to, weight, reason) => {
    if (from === to) return
    if (!adjacency.has(from)) adjacency.set(from, [])
    adjacency.get(from).push({ to, weight, reason })
  }

  // Synonym edges (1-hop): use existing FIELD_SYNONYMS mapping.
  for (const [appField, mappedFields] of Object.entries(FIELD_SYNONYMS)) {
    const requestedNormalized = normalize(appField)
    // Edge between each mapped field and every other mapped field for the same synonym group.
    const mappedNormalized = mappedFields.map(normalize).filter(Boolean)
    for (let i = 0; i < mappedNormalized.length; i++) {
      for (let j = 0; j < mappedNormalized.length; j++) {
        if (i === j) continue
        addEdge(mappedNormalized[i], mappedNormalized[j], 0.72, `synonym:${requestedNormalized}`)
      }
    }
  }

  // Category adjacency edges: connect fields that share category tokens.
  const normalizedCategories = new Map() // category -> fields[]
  for (const fieldPath of fields) {
    const cat = fieldCategories.get(fieldPath) || ""
    if (!normalizedCategories.has(cat)) normalizedCategories.set(cat, [])
    if (cat) normalizedCategories.get(cat).push(fieldPath)
  }
  for (const [cat, catFields] of normalizedCategories.entries()) {
    if (!cat || catFields.length < 2) continue
    for (let i = 0; i < catFields.length; i++) {
      for (let j = 0; j < catFields.length; j++) {
        if (i === j) continue
        addEdge(catFields[i], catFields[j], 0.36, `category:${cat}`)
      }
    }
  }

  // Token adjacency edges: connect fields with overlapping field-level tokens.
  // We keep it bounded by limiting edges per node.
  const maxEdgesPerNode = 10
  for (const from of fields) {
    const fromTokens = fieldTokens.get(from) || new Set()
    const scored = []
    for (const to of fields) {
      if (to === from) continue
      const toTokens = fieldTokens.get(to) || new Set()
      const overlap = tokenOverlap(fromTokens, toTokens)
      if (!overlap) continue
      const denom = Math.max(3, Math.min(fromTokens.size || 0, toTokens.size || 0))
      const sim = overlap / denom
      if (sim < 0.22) continue
      scored.push({ to, weight: Math.min(0.55, 0.22 + sim), reason: "token_overlap" })
    }
    scored.sort((a, b) => b.weight - a.weight)
    for (const edge of scored.slice(0, maxEdgesPerNode)) addEdge(from, edge.to, edge.weight, edge.reason)
  }

  // Ensure nodes exist in adjacency even if no edges.
  for (const field of fields) if (!adjacency.has(field)) adjacency.set(field, [])

  return { fields, adjacency, fieldTokens, fieldCategories }
}

function traversalCandidatesForRequestedField({
  requestedText,
  requestedFieldNormalized,
  memoryRecords,
  graph,
  options = {}
}) {
  const maxHops = Number(options.maxHops ?? 2)
  const frontierLimit = Number(options.frontierLimit ?? 18)
  const candidateLimit = Number(options.candidateLimit ?? 12)
  const hopDecay = Number(options.hopDecay ?? 0.78)

  const requestedTokens = tokens(requestedText)

  // Seed nodes: direct synonym target fields for this requested field,
  // plus best lexical matches' field_paths (so the traversal starts from likely local anchors).
  const synonymSeeds = FIELD_SYNONYMS[normalize(requestedText)] || []
  const seedFields = new Set(synonymSeeds.map(normalize).filter(Boolean))

  // Pre-rank memories lexically to seed traversal (small cost: reuse lexicalScore).
  const seedLexical = memoryRecords
    .map((memory) => ({ memory, fieldPath: normalize(memory.field_path || memory.path || ""), score: lexicalScoreForRequestedField(requestedText, memory) }))
    .filter((item) => item.fieldPath)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(3, Math.min(8, frontierLimit)))

  for (const { fieldPath } of seedLexical) seedFields.add(fieldPath)

  const bestByField = new Map() // field_path -> score

  // BFS with beam: keep top frontierLimit nodes per hop based on current score.
  let frontier = Array.from(seedFields).map((fieldPath) => ({ fieldPath, score: 0.5 }))
  const visited = new Map() // fieldPath -> bestScoreSeen

  for (let hop = 0; hop <= maxHops; hop++) {
    if (!frontier.length) break

    // Choose best states (beam)
    frontier.sort((a, b) => b.score - a.score)
    frontier = frontier.slice(0, frontierLimit)

    const nextFrontier = []
    for (const state of frontier) {
      const prevBest = visited.get(state.fieldPath)
      if (prevBest !== undefined && prevBest >= state.score) continue
      visited.set(state.fieldPath, state.score)

      bestByField.set(state.fieldPath, Math.max(bestByField.get(state.fieldPath) || 0, state.score))

      if (hop === maxHops) continue

      const edges = graph.adjacency.get(state.fieldPath) || []
      for (const edge of edges) {
        const hopScore = state.score * hopDecay + edge.weight * Math.pow(hopDecay, hop)
        nextFrontier.push({ fieldPath: edge.to, score: hopScore })
      }
    }
    frontier = nextFrontier
  }

  // Convert field_paths back to actual memory records for scoring.
  const fieldToMemories = new Map()
  for (const memory of memoryRecords) {
    const fieldPath = normalize(memory.field_path || memory.path || "")
    if (!fieldPath) continue
    if (!fieldToMemories.has(fieldPath)) fieldToMemories.set(fieldPath, [])
    fieldToMemories.get(fieldPath).push(memory)
  }

  const candidates = []
  for (const [fieldPath, traversalScore] of bestByField.entries()) {
    const mems = fieldToMemories.get(fieldPath) || []
    for (const memory of mems) {
      const lexical = requestedTokens.size ? lexicalScoreForRequestedField(requestedText, memory) : 0
      // Extra nudge: if fieldPath tokens overlap requested tokens, boost traversal score.
      const fieldPathTokens = graph.fieldTokens.get(fieldPath) || new Set()
      const overlap = tokenOverlap(requestedTokens, fieldPathTokens)
      const pathBoost = requestedTokens.size ? overlap / requestedTokens.size : 0
      const combinedTraversal = traversalScore * 0.78 + pathBoost * 0.18
      candidates.push({ memory, fieldPath, lexical, combined: combinedTraversal })
    }
  }

  candidates.sort((a, b) => (b.lexical * 0.55 + b.combined * 0.45) - (a.lexical * 0.55 + a.combined * 0.45))
  return candidates.slice(0, candidateLimit)
}

export function matchRequestedFields(requestedFields = [], memoryRecords = [], options = {}) {
  const threshold = Number(options.threshold ?? 0.12)
  const graph = buildFieldGraph(memoryRecords)

  return requestedFields.map((field) => {
    const fieldText = typeof field === "string" ? field : field.description || field.field_path || field.name
    const requestedNormalized = normalize(fieldText)

    // Multi-hop candidates from traversal.
    const traversalCandidates = traversalCandidatesForRequestedField({
      requestedText: fieldText,
      requestedFieldNormalized: requestedNormalized,
      memoryRecords,
      graph,
      options
    })

    // Additionally include direct lexical matches as backups (keeps old behavior robust).
    const lexicalMatches = memoryRecords
      .map((memory) => {
        const fieldPath = memory.field_path || memory.path || ""
        const score = lexicalScoreForRequestedField(fieldText, memory)
        return { field, memory, score, fieldPath }
      })
      .filter((m) => m.score >= threshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(10, Number(options.lexicalTop ?? 16)))

    const byMemoryId = new Map()

    for (const item of traversalCandidates) {
      const fieldPath = item.memory.field_path || item.memory.path || ""
      const synonymFields = FIELD_SYNONYMS[normalize(fieldText)] || []
      const synonymBoost = synonymFields.map(normalize).includes(normalize(fieldPath)) ? 0.72 : 0

      // Combine lexical + traversal.
      const score = Math.max(
        item.lexical,
        synonymBoost,
        item.lexical * 0.62 + item.combined * 0.38
      )

      if (!byMemoryId.has(item.memory)) byMemoryId.set(item.memory, null)
      byMemoryId.set(item.memory, { field, memory: item.memory, score })
    }

    // Add lexical-only items if not present.
    for (const item of lexicalMatches) {
      if (byMemoryId.has(item.memory)) continue
      byMemoryId.set(item.memory, { field, memory: item.memory, score: item.score })
    }

    const matches = [...byMemoryId.values()]
      .filter((m) => m.score >= threshold)
      .sort((a, b) => b.score - a.score)

    return { field, matches }
  })
}


