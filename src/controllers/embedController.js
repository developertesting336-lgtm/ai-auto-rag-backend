/**
 * Serves standalone client chatbot widget JavaScript
 */
export const serveChatbotWidget = (req, res) => {
  const host = req.get('host');
  const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  const apiUrl = `${protocol}://${host}/api/chatbot/query`;

  const script = `
(function() {
  const currentScript = document.currentScript || Array.from(document.querySelectorAll('script')).pop();
  const apiKey = currentScript ? currentScript.getAttribute('data-api-key') : '';
  const apiEndpoint = currentScript ? (currentScript.getAttribute('data-api-endpoint') || '${apiUrl}') : '${apiUrl}';

  if (!apiKey) {
    console.error('[AutoFlow Chatbot] Missing data-api-key attribute on script tag.');
    return;
  }

  // Create isolated container
  const container = document.createElement('div');
  container.id = 'autoflow-chat-root';
  container.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:999999;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;';
  document.body.appendChild(container);

  // Inject Styles
  const style = document.createElement('style');
  style.textContent = \`
    #autoflow-chat-btn {
      width: 52px;
      height: 52px;
      border-radius: 26px;
      background: #09090b;
      color: #fafafa;
      border: 1px solid #27272a;
      box-shadow: 0 8px 24px rgba(0,0,0,0.3);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: transform 0.2s, background 0.2s;
    }
    #autoflow-chat-btn:hover {
      transform: scale(1.05);
      background: #18181b;
    }
    #autoflow-chat-window {
      position: absolute;
      bottom: 64px;
      right: 0;
      width: 380px;
      height: 520px;
      max-width: calc(100vw - 32px);
      max-height: calc(100vh - 100px);
      background: #09090b;
      border: 1px solid #27272a;
      border-radius: 14px;
      box-shadow: 0 16px 36px rgba(0,0,0,0.45);
      display: none;
      flex-direction: column;
      overflow: hidden;
    }
    #autoflow-chat-header {
      padding: 14px 16px;
      background: #18181b;
      border-bottom: 1px solid #27272a;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    #autoflow-chat-header h4 {
      margin: 0;
      font-size: 13px;
      font-weight: 600;
      color: #f4f4f5;
    }
    #autoflow-chat-header p {
      margin: 2px 0 0 0;
      font-size: 10px;
      color: #a1a1aa;
    }
    #autoflow-chat-close {
      background: none;
      border: none;
      color: #a1a1aa;
      cursor: pointer;
      font-size: 16px;
      padding: 4px;
    }
    #autoflow-chat-messages {
      flex: 1;
      padding: 14px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .af-msg {
      max-width: 85%;
      padding: 9px 12px;
      border-radius: 10px;
      font-size: 12px;
      line-height: 1.45;
      word-break: break-word;
    }
    .af-msg-user {
      align-self: flex-end;
      background: #27272a;
      color: #fafafa;
    }
    .af-msg-bot {
      align-self: flex-start;
      background: #18181b;
      border: 1px solid #27272a;
      color: #e4e4e7;
    }
    .af-msg-bot .af-sources {
      margin-top: 6px;
      font-size: 10px;
      color: #a1a1aa;
      border-top: 1px solid #27272a;
      padding-top: 4px;
    }
    #autoflow-chat-form {
      padding: 10px 12px;
      border-top: 1px solid #27272a;
      display: flex;
      gap: 8px;
      background: #18181b;
    }
    #autoflow-chat-input {
      flex: 1;
      background: #09090b;
      border: 1px solid #27272a;
      border-radius: 8px;
      padding: 8px 12px;
      font-size: 12px;
      color: #fafafa;
      outline: none;
    }
    #autoflow-chat-send {
      background: #fafafa;
      color: #09090b;
      border: none;
      border-radius: 8px;
      padding: 0 14px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
    }
    #autoflow-chat-send:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  \`;
  document.head.appendChild(style);

  // Render HTML Structure
  container.innerHTML = \`
    <div id="autoflow-chat-window">
      <div id="autoflow-chat-header">
        <div>
          <h4>AI Support Assistant</h4>
          <p>Answers powered by verified company policies</p>
        </div>
        <button id="autoflow-chat-close" aria-label="Close chat">✕</button>
      </div>
      <div id="autoflow-chat-messages">
        <div class="af-msg af-msg-bot">
          Hello! How can I assist you with our company policies or services today?
        </div>
      </div>
      <form id="autoflow-chat-form">
        <input id="autoflow-chat-input" placeholder="Ask a question..." autocomplete="off" />
        <button type="submit" id="autoflow-chat-send">Send</button>
      </form>
    </div>
    <button id="autoflow-chat-btn" title="Open AI Chat">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
      </svg>
    </button>
  \`;

  // UI Event Listeners
  const btn = container.querySelector('#autoflow-chat-btn');
  const win = container.querySelector('#autoflow-chat-window');
  const close = container.querySelector('#autoflow-chat-close');
  const form = container.querySelector('#autoflow-chat-form');
  const input = container.querySelector('#autoflow-chat-input');
  const messages = container.querySelector('#autoflow-chat-messages');
  const sendBtn = container.querySelector('#autoflow-chat-send');

  btn.addEventListener('click', () => {
    const isHidden = win.style.display === 'none' || !win.style.display;
    win.style.display = isHidden ? 'flex' : 'none';
    if (isHidden) input.focus();
  });

  close.addEventListener('click', () => {
    win.style.display = 'none';
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const query = input.value.trim();
    if (!query) return;

    // Add user message
    const userMsg = document.createElement('div');
    userMsg.className = 'af-msg af-msg-user';
    userMsg.textContent = query;
    messages.appendChild(userMsg);
    input.value = '';
    sendBtn.disabled = true;

    // Add bot typing placeholder
    const botMsg = document.createElement('div');
    botMsg.className = 'af-msg af-msg-bot';
    botMsg.textContent = 'Thinking...';
    messages.appendChild(botMsg);
    messages.scrollTop = messages.scrollHeight;

    try {
      const res = await fetch(apiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
        },
        body: JSON.stringify({ message: query }),
      });

      const data = await res.json();

      if (data.success && data.response) {
        botMsg.textContent = data.response;
        if (data.sources && data.sources.length > 0) {
          const sourcesDiv = document.createElement('div');
          sourcesDiv.className = 'af-sources';
          const titles = data.sources.map(s => s.title || s.file_name).slice(0, 2).join(', ');
          sourcesDiv.textContent = 'Referenced: ' + titles;
          botMsg.appendChild(sourcesDiv);
        }
      } else {
        botMsg.textContent = data.error || 'Sorry, I was unable to retrieve an answer.';
      }
    } catch (err) {
      botMsg.textContent = 'Connection error. Please try again.';
    } finally {
      sendBtn.disabled = false;
      messages.scrollTop = messages.scrollHeight;
    }
  });
})();
  `;

  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.send(script);
};

