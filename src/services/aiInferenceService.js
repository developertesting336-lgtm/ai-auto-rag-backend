import { decryptKey } from '../utils/crypto.js';

/**
 * Robust Multi-Provider AI Inference Service
 * Supports Google Gemini, OpenAI, Anthropic Claude, Groq, DeepSeek, and OpenAI-compatible endpoints
 */
export async function executeAiModelInference({
  provider = 'gemini',
  model = 'gemini-2.0-flash',
  apiKey,
  systemPrompt = '',
  prompt = '',
  temperature = 0.7,
  maxTokens = 2048,
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
    const geminiModel = model || 'gemini-2.0-flash';
    const geminiUrl = baseUrl || `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${plainApiKey}`;

    const contents = [];
    if (prompt) {
      contents.push({ parts: [{ text: prompt }] });
    }

    const bodyPayload = {
      contents,
      generationConfig: {
        temperature: Number(temperature) || 0.7,
        maxOutputTokens: Number(maxTokens) || 2048,
      },
    };

    if (systemPrompt) {
      bodyPayload.systemInstruction = {
        parts: [{ text: systemPrompt }],
      };
    }

    const res = await fetch(geminiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': plainApiKey,
      },
      body: JSON.stringify(bodyPayload),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error?.message || `Gemini inference failed with HTTP ${res.status}`);
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return {
      success: true,
      provider: 'gemini',
      model: geminiModel,
      text,
      tokens: data.usageMetadata?.totalTokenCount || 0,
      durationMs: Date.now() - startTime,
    };
  }

  // 2. OpenAI / Groq / DeepSeek / Custom (OpenAI-compatible endpoints)
  if (prov === 'openai' || prov === 'groq' || prov === 'deepseek' || prov === 'custom') {
    let endpoint = 'https://api.openai.com/v1/chat/completions';
    if (prov === 'groq') endpoint = 'https://api.groq.com/openai/v1/chat/completions';
    if (prov === 'deepseek') endpoint = 'https://api.deepseek.com/chat/completions';
    if (baseUrl) endpoint = baseUrl.endsWith('/chat/completions') ? baseUrl : `${baseUrl.replace(/\/$/, '')}/chat/completions`;

    const messages = [];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push({ role: 'user', content: prompt || 'Hello' });

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${plainApiKey}`,
      },
      body: JSON.stringify({
        model: model || (prov === 'groq' ? 'llama-3.3-70b-versatile' : prov === 'deepseek' ? 'deepseek-chat' : 'gpt-4o-mini'),
        messages,
        temperature: Number(temperature) || 0.7,
        max_tokens: Number(maxTokens) || 2048,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error?.message || `${provider} API request failed with status ${res.status}`);
    }

    const text = data.choices?.[0]?.message?.content || '';
    return {
      success: true,
      provider: prov,
      model,
      text,
      tokens: data.usage?.total_tokens || 0,
      durationMs: Date.now() - startTime,
    };
  }

  // 3. Anthropic Claude
  if (prov === 'anthropic') {
    const claudeEndpoint = 'https://api.anthropic.com/v1/messages';
    const bodyPayload = {
      model: model || 'claude-3-5-sonnet-20241022',
      max_tokens: Number(maxTokens) || 2048,
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
      model,
      text,
      tokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
      durationMs: Date.now() - startTime,
    };
  }

  throw new Error(`Unsupported AI model provider: ${provider}`);
}

export default {
  executeAiModelInference,
};
