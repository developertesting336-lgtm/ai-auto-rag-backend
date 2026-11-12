let pdfParse = null;

try {
  const mod = await import('pdf-parse');
  pdfParse = mod.default || mod;
} catch (err) {
  console.warn('\x1b[33m[PDF Parser] pdf-parse not loaded yet. Run "npm install" in backend.\x1b[0m');
}

/**
 * Extracts raw textual content from an uploaded PDF file buffer
 * @param {Buffer} buffer
 * @returns {Promise<string>}
 */
export const extractTextFromPdf = async (buffer) => {
  if (!pdfParse) {
    // Basic fallback if pdf-parse isn't installed yet
    const raw = buffer.toString('utf-8');
    return raw.replace(/[^\x20-\x7E\n]/g, ' ').slice(0, 5000);
  }

  try {
    const data = await pdfParse(buffer);
    return data.text || '';
  } catch (err) {
    console.error('[PDF Parser] Failed to parse PDF text:', err.message);
    throw new Error(`Failed to extract text from PDF: ${err.message}`);
  }
};

/**
 * Splits text into overlapping semantic chunks
 * @param {string} text
 * @param {number} [maxChunkSize=1200]
 * @param {number} [overlap=150]
 * @returns {string[]}
 */
export const chunkText = (text, maxChunkSize = 1200, overlap = 150) => {
  if (!text || typeof text !== 'string') return [];

  const cleaned = text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (cleaned.length <= maxChunkSize) {
    return [cleaned];
  }

  const chunks = [];
  let startIndex = 0;

  while (startIndex < cleaned.length) {
    let endIndex = startIndex + maxChunkSize;

    if (endIndex >= cleaned.length) {
      chunks.push(cleaned.slice(startIndex).trim());
      break;
    }

    // Attempt to break cleanly on paragraph or sentence boundary
    const nextNewline = cleaned.lastIndexOf('\n', endIndex);
    const nextPeriod = cleaned.lastIndexOf('. ', endIndex);
    const boundary = Math.max(nextNewline, nextPeriod);

    if (boundary > startIndex + maxChunkSize * 0.6) {
      endIndex = boundary + (boundary === nextPeriod ? 1 : 0);
    }

    const chunk = cleaned.slice(startIndex, endIndex).trim();
    if (chunk.length > 20) {
      chunks.push(chunk);
    }

    startIndex = endIndex - overlap;
    if (startIndex >= cleaned.length) break;
  }

  return chunks;
};

let cachedEmbeddingConfig = null;

/**
 * Resolves the available Gemini embedding model and API version for this key
 */
const resolveGeminiEmbeddingConfig = async (key) => {
  if (cachedEmbeddingConfig) return cachedEmbeddingConfig;

  // Query Google's ListModels endpoint to get the exact supported embedding model
  for (const ver of ['v1beta', 'v1']) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/${ver}/models?key=${key}`, {
        headers: { 'x-goog-api-key': key },
      });
      if (res.ok) {
        const data = await res.json();
        const models = data.models || [];
        const embedModels = models.filter((m) =>
          m.supportedGenerationMethods?.includes('embedContent') ||
          m.supportedGenerationMethods?.includes('batchEmbedContents')
        );

        console.log(`[Gemini ListModels ${ver}] Available embedding models:`, embedModels.map((m) => m.name));

        // Prefer text-embedding-004, then embedding-001, then any embedding model
        const selected =
          embedModels.find((m) => m.name.includes('text-embedding-004')) ||
          embedModels.find((m) => m.name.includes('embedding-001')) ||
          embedModels.find((m) => m.name.includes('embedding')) ||
          embedModels[0];

        if (selected) {
          const rawName = selected.name.replace(/^models\//, '');
          const supportsBatch = Boolean(selected.supportedGenerationMethods?.includes('batchEmbedContents'));
          cachedEmbeddingConfig = { version: ver, model: rawName, supportsBatch };
          return cachedEmbeddingConfig;
        }
      }
    } catch (e) {
      // Continue to next version
    }
  }

  // Fallback default
  cachedEmbeddingConfig = { version: 'v1beta', model: 'text-embedding-004', supportsBatch: true };
  return cachedEmbeddingConfig;
};

/**
 * Generates vector embeddings for an array of text chunks using Google Gemini or OpenAI
 * @param {string[]} chunks
 * @param {string} apiKey - Gemini or OpenAI API Key
 * @param {string} [provider='gemini']
 * @returns {Promise<number[][]>} Array of float vectors
 */
export const generateEmbeddings = async (chunks, apiKey, provider = 'gemini') => {
  if (!chunks || chunks.length === 0) return [];

  let key = apiKey || process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY;
  let activeProvider = provider;

  if (key && key.startsWith('sk-')) {
    activeProvider = 'openai';
  } else if (!apiKey && process.env.GEMINI_API_KEY) {
    key = process.env.GEMINI_API_KEY;
    activeProvider = 'gemini';
  }

  if (!key) {
    throw new Error('No AI API key found. Add GEMINI_API_KEY in backend/.env or in your AI Integrations tab.');
  }

  // 1. Google Gemini Embeddings
  if (activeProvider === 'gemini') {
    const config = await resolveGeminiEmbeddingConfig(key);
    console.log(`[Gemini Embedding] Using model "${config.model}" on API version "${config.version}" (batch: ${config.supportsBatch})`);

    // Strategy A: Try batchEmbedContents if supported
    if (config.supportsBatch) {
      try {
        const allVectors = [];
        const batchSize = 90;

        for (let i = 0; i < chunks.length; i += batchSize) {
          const slice = chunks.slice(i, i + batchSize);
          const url = `https://generativelanguage.googleapis.com/${config.version}/models/${config.model}:batchEmbedContents?key=${key}`;

          const requests = slice.map((chunk) => ({
            model: `models/${config.model}`,
            content: {
              parts: [{ text: chunk.slice(0, 2048) }],
            },
          }));

          const response = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-goog-api-key': key,
            },
            body: JSON.stringify({ requests }),
          });

          const data = await response.json();
          if (response.ok && data.embeddings) {
            allVectors.push(...data.embeddings.map((e) => e.values));
          } else {
            throw new Error(data.error?.message || 'batchEmbedContents failed');
          }
        }

        return allVectors;
      } catch (batchErr) {
        console.warn(`[Gemini batchEmbedContents fallback] ${batchErr.message}. Trying direct embedContent...`);
      }
    }

    // Strategy B: Fallback to embedContent (per chunk in parallel)
    const url = `https://generativelanguage.googleapis.com/${config.version}/models/${config.model}:embedContent?key=${key}`;
    const embedPromises = chunks.map(async (chunk) => {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': key,
        },
        body: JSON.stringify({
          model: `models/${config.model}`,
          content: {
            parts: [{ text: chunk.slice(0, 2048) }],
          },
        }),
      });

      const data = await response.json();
      if (!response.ok || !data.embedding?.values) {
        throw new Error(data.error?.message || `embedContent failed for model ${config.model}`);
      }

      return data.embedding.values;
    });

    return await Promise.all(embedPromises);
  }

  // 2. OpenAI Embeddings (text-embedding-3-small - 1536 dimensions)
  if (activeProvider === 'openai') {
    const allVectors = [];
    const batchSize = 100;

    for (let i = 0; i < chunks.length; i += batchSize) {
      const slice = chunks.slice(i, i + batchSize);
      const url = 'https://api.openai.com/v1/embeddings';

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          input: slice.map((c) => c.slice(0, 2048)),
          model: 'text-embedding-3-small',
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error?.message || 'OpenAI Embedding API failed.');
      }

      const vectors = (data.data || []).map((item) => item.embedding);
      allVectors.push(...vectors);
    }

    return allVectors;
  }

  throw new Error(`Unsupported embedding provider: ${activeProvider}`);
};

