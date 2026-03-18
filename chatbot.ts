const OPENROUTER_AI_API_KEY = "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";

type Role = "user" | "assistant" | "system";

interface Message {
  role: Role;
  content: string;
}

interface ChatRequest {
  model: string;
  messages: Message[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
}

interface ChatChoice {
  index: number;
  message: Message;
  finish_reason: string | null;
}

interface ChatResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: ChatChoice[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface StreamDelta {
  role?: Role;
  content?: string;
}

interface StreamChoice {
  index: number;
  delta: StreamDelta;
  finish_reason: string | null;
}

interface StreamChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: StreamChoice[];
}

// ─────────────────────────────────────────────────────────────────────────────
//  Config
// ─────────────────────────────────────────────────────────────────────────────

const API_URL = "https://openrouter.ai/api/v1/chat/completions";

const DEFAULT_MODEL = "meta-llama/llama-3.2-3b-instruct:free";

// Popular free/cheap models on OpenRouter
const AVAILABLE_MODELS: Record<string, string> = {
  "Llama 3.2 3B (Free)":       "meta-llama/llama-3.2-3b-instruct:free",
  "Llama 3.2 1B (Free)":       "meta-llama/llama-3.2-1b-instruct:free",
  "Llama 3.1 8B (Free)":       "meta-llama/llama-3.1-8b-instruct:free",
  "Mistral 7B (Free)":         "mistralai/mistral-7b-instruct:free",
  "Gemma 2 9B (Free)":         "google/gemma-2-9b-it:free",
  "DeepSeek R1 (Free)":        "deepseek/deepseek-r1:free",
  "GPT-4o Mini":                "openai/gpt-4o-mini",
  "Claude Haiku 3.5":          "anthropic/claude-haiku-3-5",
};

// ─────────────────────────────────────────────────────────────────────────────
//  Core API headers
// ─────────────────────────────────────────────────────────────────────────────

function getHeaders(): HeadersInit {
  return {
    "Authorization": `Bearer ${OPENROUTER_AI_API_KEY}`,
    "Content-Type": "application/json",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  1. Basic single-turn chat (non-streaming)
// ─────────────────────────────────────────────────────────────────────────────

async function chat(
  userMessage: string,
  model: string = DEFAULT_MODEL,
  systemPrompt?: string
): Promise<string> {
  const messages: Message[] = [];

  if (systemPrompt) {
    messages.push({ role: "system", content: systemPrompt });
  }

  messages.push({ role: "user", content: userMessage });

  const body: ChatRequest = {
    model,
    messages,
  };

  const response = await fetch(API_URL, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      (error as { error?: { message?: string } })?.error?.message ??
      `HTTP ${response.status}: ${response.statusText}`
    );
  }

  const data = (await response.json()) as ChatResponse;
  const content = data.choices[0]?.message?.content;

  if (!content) throw new Error("No content in response");
  return content;
}

// ─────────────────────────────────────────────────────────────────────────────
//  2. Multi-turn conversation manager
// ─────────────────────────────────────────────────────────────────────────────

class Conversation {
  private history: Message[] = [];
  private model: string;
  private systemPrompt: string | undefined;

  constructor(model: string = DEFAULT_MODEL, systemPrompt?: string) {
    this.model = model;
    this.systemPrompt = systemPrompt;
  }

  /** Send a message and get a reply, maintaining full history */
  async send(userMessage: string): Promise<string> {
    this.history.push({ role: "user", content: userMessage });

    const messages: Message[] = [];

    if (this.systemPrompt) {
      messages.push({ role: "system", content: this.systemPrompt });
    }

    messages.push(...this.history);

    const body: ChatRequest = {
      model: this.model,
      messages,
    };

    const response = await fetch(API_URL, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      // Remove the user message we optimistically added
      this.history.pop();
      const error = await response.json().catch(() => ({}));
      throw new Error(
        (error as { error?: { message?: string } })?.error?.message ??
        `HTTP ${response.status}`
      );
    }

    const data = (await response.json()) as ChatResponse;
    const content = data.choices[0]?.message?.content ?? "";

    this.history.push({ role: "assistant", content });
    return content;
  }

  /** Send a message and stream the response token-by-token */
  async sendStream(
    userMessage: string,
    onToken: (token: string) => void,
    onDone?: (fullText: string) => void,
    signal?: AbortSignal
  ): Promise<string> {
    this.history.push({ role: "user", content: userMessage });

    const messages: Message[] = [];

    if (this.systemPrompt) {
      messages.push({ role: "system", content: this.systemPrompt });
    }

    messages.push(...this.history);

    const body: ChatRequest = {
      model: this.model,
      messages,
      stream: true,
    };

    const response = await fetch(API_URL, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      this.history.pop();
      const error = await response.json().catch(() => ({}));
      throw new Error(
        (error as { error?: { message?: string } })?.error?.message ??
        `HTTP ${response.status}`
      );
    }

    if (!response.body) throw new Error("No response body");

    const reader  = response.body.getReader();
    const decoder = new TextDecoder();
    let   buffer  = "";
    let   full    = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? ""; // keep incomplete last line

      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const raw = line.slice(5).trim();
        if (raw === "[DONE]") break;

        let chunk: StreamChunk;
        try {
          chunk = JSON.parse(raw) as StreamChunk;
        } catch {
          continue;
        }

        const token = chunk.choices[0]?.delta?.content;
        if (token) {
          full += token;
          onToken(token);
        }
      }
    }

    this.history.push({ role: "assistant", content: full });
    onDone?.(full);
    return full;
  }

  /** Clear conversation history */
  clear(): void {
    this.history = [];
  }

  /** Get a copy of the current history */
  getHistory(): Message[] {
    return [...this.history];
  }

  /** Change the model mid-conversation */
  setModel(model: string): void {
    this.model = model;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  3. Fetch available models from OpenRouter
// ─────────────────────────────────────────────────────────────────────────────

interface OpenRouterModel {
  id: string;
  name: string;
  context_length: number;
  pricing: {
    prompt: string;
    completion: string;
  };
}

async function fetchModels(): Promise<OpenRouterModel[]> {
  const response = await fetch("https://openrouter.ai/api/v1/models", {
    headers: getHeaders(),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch models: HTTP ${response.status}`);
  }

  const data = (await response.json()) as { data: OpenRouterModel[] };
  return data.data;
}

// ─────────────────────────────────────────────────────────────────────────────
//  4. DOM Chatbot — wires everything to the HTML UI
// ─────────────────────────────────────────────────────────────────────────────

class DOMChatbot {
  private conv: Conversation;
  private abortCtrl: AbortController | null = null;
  private streaming = false;

  // Sidebar chat sessions
  private sessions: Array<{ id: string; title: string; history: Message[] }> = [];
  private activeId = "";

  constructor() {
    this.conv = new Conversation(DEFAULT_MODEL);
    this.init();
  }

  private init(): void {
    this.newSession();
    this.bindInput();
  }

  // ── Input bindings ───────────────────────────────────────────────────

  private bindInput(): void {
    const input = document.getElementById("chatInput") as HTMLTextAreaElement;

    input.addEventListener("input", () => {
      input.style.height = "auto";
      input.style.height = input.scrollHeight + "px";
      const counter = document.getElementById("charCount");
      if (counter) counter.textContent = String(input.value.length);
    });

    input.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void this.send();
      }
    });

    const sendBtn = document.getElementById("sendBtn");
    sendBtn?.addEventListener("click", () => void this.send());

    const stopBtn = document.getElementById("stopBtn");
    stopBtn?.addEventListener("click", () => this.stop());

    const newChatBtn = document.querySelector(".new-chat-btn");
    newChatBtn?.addEventListener("click", () => this.newSession());
  }

  // ── Send message ─────────────────────────────────────────────────────

  async send(): Promise<void> {
    const input = document.getElementById("chatInput") as HTMLTextAreaElement;
    const text  = input.value.trim();
    if (!text || this.streaming) return;

    this.appendUserBubble(text);
    input.value = "";
    input.style.height = "auto";

    this.updateSessionTitle(text);
    this.setStreaming(true);

    const bubbleId = this.createAiBubble();
    const bubble   = document.getElementById(bubbleId)!;
    let   full     = "";

    this.abortCtrl = new AbortController();

    try {
      await this.conv.sendStream(
        text,
        (token) => {
          full += token;
          bubble.innerHTML = this.renderMarkdown(full) + '<span class="cursor"></span>';
          this.scrollToBottom();
        },
        (finalText) => {
          this.finalizeBubble(bubbleId, finalText);
        },
        this.abortCtrl.signal
      );
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        this.finalizeBubble(bubbleId, full || "*(stopped)*");
      } else {
        this.showError(bubbleId, (err as Error).message);
      }
    } finally {
      this.setStreaming(false);
    }
  }

  stop(): void {
    this.abortCtrl?.abort();
  }

  // ── Render helpers ───────────────────────────────────────────────────

  private renderMarkdown(text: string): string {
    // Code blocks
    text = text.replace(/```(\w*)\n?([\s\S]*?)```/g,
      (_, _lang, code: string) => `<pre><code>${this.esc(code.trim())}</code></pre>`);
    // Inline code
    text = text.replace(/`([^`\n]+)`/g,
      (_, c: string) => `<code>${this.esc(c)}</code>`);
    // Bold
    text = text.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    // Newlines
    text = text.replace(/\n/g, "<br>");
    return text;
  }

  private esc(s: string): string {
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  private ts(): string {
    return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  private scrollToBottom(): void {
    const msgs = document.getElementById("messages");
    if (msgs) msgs.scrollTop = msgs.scrollHeight;
  }

  private sysMsg(html: string): void {
    const msgs = document.getElementById("messages")!;
    const d = document.createElement("div");
    d.className = "sys-msg";
    d.innerHTML = `<span>${html}</span>`;
    msgs.appendChild(d);
    this.scrollToBottom();
  }

  private appendUserBubble(text: string): void {
    const msgs = document.getElementById("messages")!;
    const row  = document.createElement("div");
    row.className = "message-row user";
    row.innerHTML = `
      <div class="msg-avatar user">J</div>
      <div class="msg-body">
        <div class="msg-meta">
          <span class="msg-name user">You</span>
          <span class="msg-time">${this.ts()}</span>
        </div>
        <div class="msg-bubble">${this.esc(text)}</div>
        <div class="msg-actions">
          <button class="msg-action-btn" data-copy="${this.esc(text)}">📋 Copy</button>
        </div>
      </div>`;
    row.querySelector("[data-copy]")?.addEventListener("click", (e) => {
      const btn = e.currentTarget as HTMLButtonElement;
      void navigator.clipboard.writeText(btn.dataset["copy"] ?? "").then(() => {
        btn.textContent = "✓ Copied";
        setTimeout(() => { btn.textContent = "📋 Copy"; }, 1500);
      });
    });
    msgs.appendChild(row);
    this.scrollToBottom();
  }

  private createAiBubble(): string {
    const msgs = document.getElementById("messages")!;
    const id   = "b" + Date.now();
    const row  = document.createElement("div");
    row.className = "message-row";
    row.innerHTML = `
      <div class="msg-avatar ai">✦</div>
      <div class="msg-body">
        <div class="msg-meta">
          <span class="msg-name ai">AuraAI</span>
          <span class="msg-time">${this.ts()}</span>
        </div>
        <div class="msg-bubble" id="${id}"><span class="cursor"></span></div>
        <div class="msg-actions" id="a${id}"></div>
      </div>`;
    msgs.appendChild(row);
    this.scrollToBottom();
    return id;
  }

  private finalizeBubble(id: string, text: string): void {
    const bubble  = document.getElementById(id);
    const actions = document.getElementById("a" + id);
    if (!bubble || !actions) return;

    bubble.innerHTML = this.renderMarkdown(text);

    const copyBtn  = document.createElement("button");
    copyBtn.className = "msg-action-btn";
    copyBtn.textContent = "📋 Copy";
    copyBtn.addEventListener("click", () => {
      void navigator.clipboard.writeText(text).then(() => {
        copyBtn.textContent = "✓ Copied";
        setTimeout(() => { copyBtn.textContent = "📋 Copy"; }, 1500);
      });
    });

    const retryBtn = document.createElement("button");
    retryBtn.className = "msg-action-btn";
    retryBtn.textContent = "🔁 Retry";
    retryBtn.addEventListener("click", () => void this.retry());

    const goodBtn  = document.createElement("button");
    goodBtn.className = "msg-action-btn";
    goodBtn.textContent = "👍 Good";

    actions.append(copyBtn, retryBtn, goodBtn);
  }

  private showError(id: string, message: string): void {
    const bubble = document.getElementById(id);
    if (!bubble) return;
    bubble.className = "msg-bubble error";
    bubble.textContent = "⚠ " + message;
  }

  // ── Retry ────────────────────────────────────────────────────────────

  async retry(): Promise<void> {
    const history = this.conv.getHistory();
    const lastUserIdx = [...history].map(m => m.role).lastIndexOf("user");
    if (lastUserIdx < 0) return;

    const userMsg = history[lastUserIdx].content;

    // Rebuild history without the last exchange
    this.conv.clear();
    for (const m of history.slice(0, lastUserIdx)) {
      // Re-add prior context (not through the API — just set history directly)
    }

    // Remove last two rendered rows
    const msgs = document.getElementById("messages")!;
    const rows = msgs.querySelectorAll(".message-row");
    rows[rows.length - 1]?.remove();
    rows[rows.length - 2]?.remove();

    const input = document.getElementById("chatInput") as HTMLTextAreaElement;
    input.value = userMsg;
    await this.send();
  }

  // ── Session management ───────────────────────────────────────────────

  newSession(): void {
    // Save current
    const cur = this.sessions.find(s => s.id === this.activeId);
    if (cur) cur.history = this.conv.getHistory();

    const id = "s" + Date.now();
    this.sessions.push({ id, title: "New Chat", history: [] });
    this.activeId = id;
    this.conv.clear();

    const msgs = document.getElementById("messages");
    if (msgs) msgs.innerHTML = "";
    this.sysMsg("New conversation started ✦");
    this.renderSessionList();
  }

  switchSession(id: string): void {
    const cur = this.sessions.find(s => s.id === this.activeId);
    if (cur) cur.history = this.conv.getHistory();

    const target = this.sessions.find(s => s.id === id);
    if (!target) return;

    this.activeId = id;
    this.conv.clear();

    const msgs = document.getElementById("messages")!;
    msgs.innerHTML = "";

    // Re-render messages from saved history
    for (const m of target.history) {
      if (m.role === "user") {
        this.appendUserBubble(m.content);
      } else if (m.role === "assistant") {
        const bid = this.createAiBubble();
        this.finalizeBubble(bid, m.content);
      }
    }

    if (!target.history.length) this.sysMsg("Conversation loaded.");
    this.renderSessionList();
  }

  private updateSessionTitle(text: string): void {
    const s = this.sessions.find(s => s.id === this.activeId);
    if (s && s.title === "New Chat") {
      s.title = text.slice(0, 30) + (text.length > 30 ? "…" : "");
      this.renderSessionList();
    }
  }

  private renderSessionList(): void {
    const list = document.getElementById("chatList");
    if (!list) return;
    list.innerHTML = "";

    [...this.sessions].reverse().forEach(s => {
      const d = document.createElement("div");
      d.className = "chat-item" + (s.id === this.activeId ? " active" : "");
      d.innerHTML = `<span class="dot"></span>${this.esc(s.title)}`;
      d.addEventListener("click", () => this.switchSession(s.id));
      list.appendChild(d);
    });
  }

  // ── Streaming toggle ─────────────────────────────────────────────────

  private setStreaming(on: boolean): void {
    this.streaming = on;
    const sendBtn = document.getElementById("sendBtn");
    const stopBtn = document.getElementById("stopBtn");
    const input   = document.getElementById("chatInput") as HTMLTextAreaElement;

    sendBtn?.classList.toggle("hidden", on);
    stopBtn?.classList.toggle("hidden", !on);
    if (input) input.disabled = on;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  5. Usage examples (Node.js / non-browser context)
// ─────────────────────────────────────────────────────────────────────────────

async function exampleBasicChat(): Promise<void> {
  const reply = await chat("What is the meaning of life?");
  console.log("Reply:", reply);
}

async function exampleConversation(): Promise<void> {
  const convo = new Conversation(DEFAULT_MODEL, "You are a concise assistant.");

  const r1 = await convo.send("Hello! What can you do?");
  console.log("AI:", r1);

  const r2 = await convo.send("Give me a haiku about TypeScript.");
  console.log("AI:", r2);
}

async function exampleStreamToConsole(): Promise<void> {
  const convo = new Conversation();
  let   full  = "";

  console.log("AI: ");
  await convo.sendStream(
    "Explain async/await in 2 sentences.",
    (token) => {
      full += token;
      // In a real terminal you'd use process.stdout — here we buffer and log on done
    },
    () => {
      console.log(full);
      console.log("--- done ---");
    }
  );
}

async function exampleListModels(): Promise<void> {
  const models = await fetchModels();
  const free   = models.filter(m => m.pricing.prompt === "0");
  console.log(`Free models (${free.length}):`);
  free.forEach(m => console.log(` • ${m.id}  (ctx: ${m.context_length})`));
}

// ─────────────────────────────────────────────────────────────────────────────
//  6. Entry point
// ─────────────────────────────────────────────────────────────────────────────

// Browser: mount the DOM chatbot
if (typeof window !== "undefined") {
  window.addEventListener("DOMContentLoaded", () => {
    (window as unknown as Record<string, unknown>)["chatbot"] = new DOMChatbot();
  });
}

// Node.js (with @types/node): uncomment to auto-run from the command line
// import { argv } from "node:process";
// if (argv[1]?.endsWith("chatbot.ts")) void exampleStreamToConsole();

// ─────────────────────────────────────────────────────────────────────────────
//  Exports  (for use as a module)
// ─────────────────────────────────────────────────────────────────────────────

export {
  chat,
  Conversation,
  fetchModels,
  DOMChatbot,
  AVAILABLE_MODELS,
  DEFAULT_MODEL,
  type Message,
  type ChatResponse,
  type StreamChunk,
};
