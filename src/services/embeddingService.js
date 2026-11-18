import zlib from 'zlib';

let pdfParse = null;

try {
  const mod = await import('pdf-parse');
  pdfParse = mod.default || mod;
} catch (err) {
  console.warn('\x1b[33m[PDF Parser] pdf-parse not loaded yet. Run "npm install" in backend.\x1b[0m');
}

/**
 * Fallback parser that decompresses raw PDF FlateDecode streams directly
 * without depending on the cross-reference (XRef) table.
 */
function extractFromRawPdfStreams(buffer) {
  try {
    const textPieces = [];
    const bufStr = buffer.toString('binary');

    let searchPos = 0;
    while (searchPos < bufStr.length) {
      const streamIdx = bufStr.indexOf('stream', searchPos);
      if (streamIdx === -1) break;

      let dataStart = streamIdx + 6;
      if (bufStr[dataStart] === '\r') dataStart++;
      if (bufStr[dataStart] === '\n') dataStart++;

      const endstreamIdx = bufStr.indexOf('endstream', dataStart);
      if (endstreamIdx === -1) break;

      let dataEnd = endstreamIdx;
      if (bufStr[dataEnd - 1] === '\n') dataEnd--;
      if (bufStr[dataEnd - 1] === '\r') dataEnd--;

      const streamData = buffer.subarray(dataStart, dataEnd);
      searchPos = endstreamIdx + 9;

      if (streamData.length < 4) continue;

      let decompressed = null;
      try {
        decompressed = zlib.inflateSync(streamData);
      } catch {
        try {
          decompressed = zlib.inflateRawSync(streamData);
        } catch {
          decompressed = streamData;
        }
      }

      if (decompressed) {
        const streamText = decompressed.toString('latin1');
        const matches = streamText.match(/\((?:[^()\\]|\\.)*\)/g);
        if (matches && matches.length > 0) {
          for (const m of matches) {
            const raw = m
              .slice(1, -1)
              .replace(/\\([()\\])/g, '$1')
              .replace(/\\n/g, '\n')
              .replace(/\\r/g, '\r')
              .replace(/\\t/g, '\t');

            if (/^[a-zA-Z0-9\s.,!?:;'"@#\$%^&*()_\-+=/\\\[\]{}|`~]+$/.test(raw) && raw.trim().length > 1) {
              textPieces.push(raw.trim());
            }
          }
        }
      }
    }

    return textPieces.join(' ').replace(/\s+/g, ' ').trim();
  } catch (err) {
    console.warn('[PDF Stream Extractor Note]:', err.message);
    return '';
  }
}

/**
 * Extracts raw textual content from an uploaded PDF file buffer
 * Uses a resilient 4-layer extraction pipeline:
 * 1. Sanitization (%PDF- header alignment & fresh memory view)
 * 2. Primary pdf-parse engine
 * 3. Modern pdf.js engine (v2.0.550 with automatic XRef recovery)
 * 4. Raw FlateDecode stream decompressor (bypasses corrupted XRef completely)
 * @param {Buffer} buffer
 * @returns {Promise<string>}
 */
export const extractTextFromPdf = async (buffer) => {
  if (!buffer || buffer.length === 0) return '';

  // 1. Sanitize buffer: Align to standard %PDF- header to fix bad byte offsets / leading junk
  const headerOffset = buffer.indexOf(Buffer.from('%PDF-'));
  const cleanBuffer = headerOffset > 0 ? Buffer.from(buffer.subarray(headerOffset)) : Buffer.from(buffer);

  // 2. Try primary pdf-parse engine
  if (pdfParse) {
    try {
      const data = await pdfParse(cleanBuffer);
      if (data && data.text && data.text.trim().length > 20) {
        return data.text.trim();
      }
    } catch (primaryErr) {
      console.warn(`[PDF Parser] Primary pdf-parse note (${primaryErr.message}). Trying version v2.0.550...`);
    }

    // 3. Try bundled v2.0.550 with modern XRef recovery
    try {
      const dataV2 = await pdfParse(cleanBuffer, { version: 'v2.0.550' });
      if (dataV2 && dataV2.text && dataV2.text.trim().length > 20) {
        return dataV2.text.trim();
      }
    } catch (v2Err) {
      console.warn(`[PDF Parser] v2.0.550 note (${v2Err.message}). Trying raw stream decompressor...`);
    }
  }

  // 4. Try raw FlateDecode stream decompressor (bypasses corrupt/bad XRef tables entirely)
  const streamText = extractFromRawPdfStreams(cleanBuffer);
  if (streamText && streamText.length > 20) {
    console.log(`[PDF Parser] Successfully extracted ${streamText.length} characters using stream decompressor fallback.`);
    return streamText;
  }

  // 5. Final fallback: Clean ASCII strings
  const rawFallback = cleanBuffer.toString('utf-8').replace(/[^\x20-\x7E\n]/g, ' ');
  const cleaned = rawFallback.replace(/\s+/g, ' ').trim();
  if (cleaned.length > 20) {
    return cleaned.slice(0, 10000);
  }

  throw new Error('Unable to extract text from PDF. The document may be an empty or scanned image PDF without selectable text.');
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

