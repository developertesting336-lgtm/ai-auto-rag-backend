import { decryptKey } from '../utils/crypto.js';

/**
 * Universal Multi-Provider AI Inference Service
 * Seamlessly supports Google Gemini, OpenAI, Anthropic Claude, Groq, DeepSeek,
 * Mistral, OpenRouter, Ollama, Together AI, and ANY custom OpenAI-compatible API.
 */
export async function executeAiModelInference({
  provider = 'gemini',
  model,
  apiKey,
  systemPrompt = '',
  prompt = '',
  temperature = 0.7,
  maxTokens,
  baseUrl = null,
}) {
  const plainApiKey = decryptKey(apiKey);
  if (!plainApiKey) {
    throw new Error(`Missing API Key for provider "${provider}". Please configure an API key.`);
  }

  const startTime = Date.now();
  const prov = (provider || 'gemini').toLowerCase().trim();

  // 1. Google Gemini
  if (prov === 'gemini') {
    let targetModel = (model || 'gemini-3.8-flash').replace(/^models\//, '').trim();
    if (
      targetModel === 'gemini-2.0-flash' ||
      targetModel === 'gemini-2.5-flash' ||
      targetModel === 'gemini-1.5-flash' ||
      !targetModel
    ) {
      targetModel = 'gemini-3.8-flash';
    }

    const candidateModels = Array.from(
      new Set([targetModel, 'gemini-3.8-flash', 'gemini-flash-lite-latest', 'gemini-flash-latest'])
    );

    const contents = [];
    if (prompt) {
      contents.push({ parts: [{ text: prompt }] });
    }

    const generationConfig = {
      temperature: Number(temperature) || 0.7,
    };
    if (maxTokens) {
      generationConfig.maxOutputTokens = Number(maxTokens);
    }

    const bodyPayload = {
      contents,
      generationConfig,
    };

    if (systemPrompt) {
      bodyPayload.systemInstruction = {
        parts: [{ text: systemPrompt }],
      };
    }

    let lastError = null;
    let successfulData = null;
    let chosenModel = targetModel;

    for (const cand of candidateModels) {
      try {
        const geminiUrl = baseUrl || `https://generativelanguage.googleapis.com/v1beta/models/${cand}:generateContent?key=${plainApiKey}`;
        const res = await fetch(geminiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': plainApiKey,
          },
          body: JSON.stringify(bodyPayload),
        });

        const data = await res.json();
        if (res.ok) {
          successfulData = data;
          chosenModel = cand;
          break;
        } else {
          lastError = new Error(data.error?.message || `Gemini inference failed with HTTP ${res.status}`);
          // If 503 (high demand) or 404 (model deprecated/not available), gracefully try next candidate
          if (res.status === 503 || res.status === 404) {
            continue;
          }
          // If 400 (invalid key), stop and throw immediately
          throw lastError;
        }
      } catch (err) {
        lastError = err;
        if (err.message?.includes('API key not valid')) {
          throw err;
        }
      }
    }

    if (!successfulData) {
      throw lastError || new Error('Gemini inference failed across candidate models.');
    }

    const text = successfulData.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return {
      success: true,
      provider: 'gemini',
      model: chosenModel,
      text,
      tokens: successfulData.usageMetadata?.totalTokenCount || 0,
      durationMs: Date.now() - startTime,
    };
  }

  // 2. Anthropic Claude
  if (prov === 'anthropic') {
    const claudeEndpoint = baseUrl || 'https://api.anthropic.com/v1/messages';
    const claudeModel = model || 'claude-3-5-sonnet-20241022';
    const bodyPayload = {
      model: claudeModel,
      max_tokens: Number(maxTokens) || 4096,
      temperature: Number(temperature) || 0.7,
      messages: [{ role: 'user', content: prompt || 'Hello' }],
    };

    if (systemPrompt) {
      bodyPayload.system = systemPrompt;
    }

    const res = await fetch(claudeEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': plainApiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(bodyPayload),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error?.message || `Anthropic API request failed with status ${res.status}`);
    }

    const text = data.content?.[0]?.text || '';
    return {
      success: true,
      provider: 'anthropic',
      model: claudeModel,
      text,
      tokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
      durationMs: Date.now() - startTime,
    };
  }

  // 3. Universal OpenAI-compatible handler (OpenAI, Groq, DeepSeek, Mistral, OpenRouter, Ollama, Custom APIs)
  let endpoint = 'https://api.openai.com/v1/chat/completions';
  let resolvedModel = model || 'gpt-4o-mini';

  if (prov === 'groq') {
    endpoint = 'https://api.groq.com/openai/v1/chat/completions';
    resolvedModel = model || 'llama-3.3-70b-versatile';
  } else if (prov === 'deepseek') {
    endpoint = 'https://api.deepseek.com/chat/completions';
    resolvedModel = model || 'deepseek-chat';
  } else if (prov === 'mistral') {
    endpoint = 'https://api.mistral.ai/v1/chat/completions';
    resolvedModel = model || 'mistral-large-latest';
  } else if (prov === 'openrouter') {
    endpoint = 'https://openrouter.ai/api/v1/chat/completions';
    resolvedModel = model || 'openai/gpt-4o';
  } else if (baseUrl) {
    endpoint = baseUrl.endsWith('/chat/completions')
      ? baseUrl
      : `${baseUrl.replace(/\/$/, '')}/chat/completions`;
    resolvedModel = model || 'default';
  }

  const messages = [];
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }
  messages.push({ role: 'user', content: prompt || 'Hello' });

  const payload = {
    model: resolvedModel,
    messages,
    temperature: Number(temperature) || 0.7,
  };
  if (maxTokens) {
    payload.max_tokens = Number(maxTokens);
  }

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${plainApiKey}`,
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error?.message || `${provider} API request failed with status ${res.status}`);
  }

  const text = data.choices?.[0]?.message?.content || '';
  return {
    success: true,
    provider: prov,
    model: resolvedModel,
    text,
    tokens: data.usage?.total_tokens || 0,
    durationMs: Date.now() - startTime,
  };
}

export default {
  executeAiModelInference,
};
