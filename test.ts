// ─────────────────────────────────────────────────────────────────────────────
//  test.ts  —  Run this to verify your OpenRouter API key works
//  Run:  npm run test
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

// ── Load .env file ────────────────────────────────────────────────────────────

function loadEnv(): void {
  const envPath = resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) return;
  const lines = readFileSync(envPath, "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnv();

// ── Config ────────────────────────────────────────────────────────────────────

const OPENROUTER_AI_API_KEY: string = process.env["OPENROUTER_AI_API_KEY"] ?? "";
const MODEL   = "mistralai/mistral-7b-instruct:free";
const API_URL = "https://openrouter.ai/api/v1/chat/completions";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Message       { role: "user" | "assistant" | "system"; content: string; }
interface ChatResponse  { choices: Array<{ message: Message; finish_reason: string | null }>; model: string; }
interface StreamChunk   { choices: Array<{ delta: { content?: string }; finish_reason: string | null }>; }
interface ErrorResponse { error?: { message?: string; code?: number }; }

// ── Helpers ───────────────────────────────────────────────────────────────────

function headers(): Record<string, string> {
  return {
    "Authorization": `Bearer ${OPENROUTER_AI_API_KEY}`,
    "HTTP-Referer":  "http://localhost:3000",
    "Content-Type":  "application/json",
  };
}

function log(label: string, msg: string, ok = true): void {
  console.log(`${ok ? "✅" : "❌"}  ${label}: ${msg}`);
}

// ── Test 1: Key validation ────────────────────────────────────────────────────

function testKeyFormat(): boolean {
  console.log("\n── Test 1: API Key Format ──────────────────────────");
  if (!OPENROUTER_AI_API_KEY) {
    log("Key", "No key found — make sure .env contains OPENROUTER_AI_API_KEY=sk-or-v1-...", false);
    return false;
  }
  if (!OPENROUTER_AI_API_KEY.startsWith("sk-or-")) {
    log("Key format", `Starts with "${OPENROUTER_AI_API_KEY.slice(0, 10)}…" — expected sk-or-v1-`, false);
    return false;
  }
  log("Key format", `sk-or-v1-… ✓  (length: ${OPENROUTER_AI_API_KEY.length})`);
  return true;
}

// ── Test 2: Non-streaming chat ────────────────────────────────────────────────

async function testBasicChat(): Promise<boolean> {
  console.log("\n── Test 2: Basic (non-streaming) Chat ──────────────");
  try {
    const res = await fetch(API_URL, {
      method:  "POST",
      headers: headers(),
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: "user", content: 'Reply with exactly: "CONNECTION OK"' }],
      }),
    });

    const data = (await res.json()) as ChatResponse & ErrorResponse;

    if (!res.ok) {
      log("HTTP", `${res.status} — ${data.error?.message ?? res.statusText}`, false);
      if (res.status === 401) console.log("     → Invalid or expired API key.");
      if (res.status === 402) console.log("     → No credits. Verify your OpenRouter account.");
      if (res.status === 429) console.log("     → Rate limited. Try a different model or wait.");
      if (res.status === 404) console.log("     → Model not found. Check the model ID string.");
      return false;
    }

    const reply = data.choices?.[0]?.message?.content ?? "(empty)";
    log("Response",   reply.trim().slice(0, 80));
    log("Model used", data.model ?? MODEL);
    return true;
  } catch (err) {
    log("Network", (err as Error).message, false);
    console.log("     → Are you connected to the internet?");
    return false;
  }
}

// ── Test 3: Streaming chat ────────────────────────────────────────────────────

async function testStreaming(): Promise<boolean> {
  console.log("\n── Test 3: Streaming Chat ──────────────────────────");
  try {
    const res = await fetch(API_URL, {
      method:  "POST",
      headers: headers(),
      body: JSON.stringify({
        model:    MODEL,
        stream:   true,
        messages: [{ role: "user", content: "Count to 5, one number per line." }],
      }),
    });

    if (!res.ok) {
      const data = (await res.json()) as ErrorResponse;
      log("HTTP", `${res.status} — ${data.error?.message ?? res.statusText}`, false);
      return false;
    }
    if (!res.body) { log("Stream", "No response body", false); return false; }

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let   buffer  = "";
    let   full    = "";
    let   chunks  = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const raw = line.slice(5).trim();
        if (raw === "[DONE]") break;
        let chunk: StreamChunk;
        try { chunk = JSON.parse(raw) as StreamChunk; } catch { continue; }
        const token = chunk.choices[0]?.delta?.content;
        if (token) { full += token; chunks++; }
      }
    }

    log("Chunks received", String(chunks));
    log("Full response",   full.trim().replace(/\n/g, " | ").slice(0, 80));
    return chunks > 0;
  } catch (err) {
    log("Network", (err as Error).message, false);
    return false;
  }
}

// ── Test 4: Multi-turn conversation ──────────────────────────────────────────

async function testMultiTurn(): Promise<boolean> {
  console.log("\n── Test 4: Multi-turn Memory ───────────────────────");
  const history: Message[] = [];

  async function turn(userMsg: string): Promise<string> {
    history.push({ role: "user", content: userMsg });
    const res  = await fetch(API_URL, {
      method:  "POST",
      headers: headers(),
      body:    JSON.stringify({ model: MODEL, messages: history }),
    });
    const data  = (await res.json()) as ChatResponse;
    const reply = data.choices?.[0]?.message?.content ?? "";
    history.push({ role: "assistant", content: reply });
    return reply;
  }

  try {
    const r1 = await turn("My name is Alex. Just say 'Got it, Alex.'");
    log("Turn 1", r1.trim().slice(0, 60));
    const r2 = await turn("What is my name?");
    const ok = r2.toLowerCase().includes("alex");
    log("Turn 2 (memory check)", r2.trim().slice(0, 60), ok);
    if (!ok) console.log("     → Model didn't recall the name — history may not be sending correctly.");
    return ok;
  } catch (err) {
    log("Network", (err as Error).message, false);
    return false;
  }
}

// ── Run all ───────────────────────────────────────────────────────────────────

async function runAll(): Promise<void> {
  console.log("═══════════════════════════════════════════════════");
  console.log("  OpenRouter API Connection Tests");
  console.log(`  Model: ${MODEL}`);
  console.log("═══════════════════════════════════════════════════");

  const results: Record<string, boolean> = {};

  results["Key format"] = testKeyFormat();
  if (!results["Key format"]) {
    console.log("\n⛔ Fix your API key first, then re-run:  npm run test\n"); return;
  }

  results["Basic chat"] = await testBasicChat();
  if (!results["Basic chat"]) {
    console.log("\n⛔ Basic connection failed — fix the error above before continuing\n"); return;
  }

  results["Streaming"]   = await testStreaming();
  results["Multi-turn"]  = await testMultiTurn();

  console.log("\n═══════════════════════════════════════════════════");
  console.log("  Summary");
  console.log("═══════════════════════════════════════════════════");
  for (const [name, passed] of Object.entries(results)) {
    console.log(`  ${passed ? "✅" : "❌"}  ${name}`);
  }
  const allPassed = Object.values(results).every(Boolean);
  console.log(allPassed
    ? "\n🎉 All tests passed! Your API connection is working.\n"
    : "\n⚠️  Some tests failed. Check the errors above.\n"
  );
}

void runAll();
