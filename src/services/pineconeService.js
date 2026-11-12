let Pinecone = null;

try {
  const mod = await import('@pinecone-database/pinecone');
  Pinecone = mod.Pinecone;
} catch (err) {
  console.warn('\x1b[33m[Pinecone] @pinecone-database/pinecone not loaded yet. Run "npm install" in backend.\x1b[0m');
}

/**
 * Returns a configured Pinecone Client
 */
export const getPineconeClient = () => {
  const apiKey = process.env.PINECONE_API_KEY;
  if (!Pinecone || !apiKey) {
    return null;
  }
  try {
    return new Pinecone({ apiKey });
  } catch (err) {
    console.error('[Pinecone] Failed to initialize Pinecone client:', err.message);
    return null;
  }
};

/**
 * Returns a configured Pinecone Index client
 */
export const getPineconeIndex = () => {
  const pc = getPineconeClient();
  const indexName = process.env.PINECONE_INDEX || 'company-policies';
  return pc ? pc.index(indexName) : null;
};

/**
 * Ensures the target Pinecone index exists, auto-creating serverless index if needed
 * @param {number} [dimension=768]
 */
export const ensurePineconeIndexExists = async (dimension = 768) => {
  const pc = getPineconeClient();
  const indexName = process.env.PINECONE_INDEX || 'company-policies';
  if (!pc) return null;

  try {
    const list = await pc.listIndexes();
    const exists = (list.indexes || []).some((idx) => idx.name === indexName);

    if (!exists) {
      console.log(`[Pinecone] Index "${indexName}" not found. Auto-creating serverless index (dim: ${dimension}, metric: cosine)...`);
      await pc.createIndex({
        name: indexName,
        dimension,
        metric: 'cosine',
        spec: {
          serverless: {
            cloud: 'aws',
            region: 'us-east-1',
          },
        },
      });
      console.log(`[Pinecone] Index "${indexName}" created successfully.`);
    }
  } catch (err) {
    console.warn(`[Pinecone Index Check] ${err.message}`);
  }

  return pc.index(indexName);
};

/**
 * Upsert document chunks and vectors into Pinecone DB
 * @param {Object} params
 * @param {string} params.companyId
 * @param {string} params.policyId
 * @param {string} params.title
 * @param {string} params.fileName
 * @param {string[]} params.chunks
 * @param {number[][]} params.vectors
 */
export const upsertPolicyVectors = async ({
  companyId,
  policyId,
  title,
  fileName,
  chunks,
  vectors,
}) => {
  const dimension = vectors[0]?.length || 768;
  const index = await ensurePineconeIndexExists(dimension);

  if (!index) {
    console.warn('[Pinecone] Pinecone client or API key not available. Vectors not upserted.');
    return { success: false, reason: 'PINECONE_API_KEY missing or client unavailable.' };
  }

  const records = chunks.map((chunkText, i) => ({
    id: `${policyId}_c${i}`,
    values: vectors[i],
    metadata: {
      company_id: companyId,
      policy_id: policyId,
      title: title || 'Company Policy',
      file_name: fileName,
      chunk_index: i,
      text: chunkText,
    },
  }));

  // Batch in chunks of 50 for Pinecone upsert limit
  const batchSize = 50;
  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    await index.upsert(batch);
  }

  return { success: true, count: records.length };
};

/**
 * Delete all vectors associated with a specific policy
 * @param {string} policyId
 * @param {number} chunkCount
 */
export const deletePolicyVectors = async (policyId, chunkCount = 50) => {
  const index = getPineconeIndex();
  if (!index) return false;

  try {
    const ids = Array.from({ length: chunkCount }, (_, i) => `${policyId}_c${i}`);
    await index.deleteMany(ids);
    return true;
  } catch (err) {
    console.error('[Pinecone] Failed to delete vectors:', err.message);
    return false;
  }
};

/**
 * Query Pinecone for top-K policy chunks matching a query vector
 * Strictly scoped to the specified companyId
 * @param {Object} params
 * @param {string} params.companyId
 * @param {number[]} params.queryVector
 * @param {number} [params.topK=4]
 * @returns {Promise<Array<{ text: string, title: string, file_name: string, score: number, policy_id: string }>>}
 */
export const querySimilarPolicyChunks = async ({ companyId, queryVector, topK = 4 }) => {
  const index = getPineconeIndex();

  if (!index) {
    return [];
  }

  try {
    const response = await index.query({
      vector: queryVector,
      topK,
      filter: {
        company_id: { $eq: companyId },
      },
      includeMetadata: true,
    });

    const matches = (response.matches || [])
      .filter((m) => m.metadata && m.metadata.text)
      .map((m) => ({
        score: m.score,
        text: m.metadata.text,
        title: m.metadata.title,
        file_name: m.metadata.file_name,
        policy_id: m.metadata.policy_id,
      }));

    return matches;
  } catch (err) {
    console.error('[Pinecone Query] Error searching vectors:', err.message);
    return [];
  }
};

