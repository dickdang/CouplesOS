import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const root = process.cwd();
const port = Number(process.argv[2] || 5173);
const openAiModel = process.env.OPENAI_MODEL || "gpt-5";
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8"
};

const appTools = [
  {
    type: "function",
    name: "create_task",
    description: "Create a single CoupleOS task chat with an owner, due date, category, and optional project.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        title: { type: "string" },
        chatTitle: { type: "string" },
        agentName: { type: "string" },
        owner: { type: "string", enum: ["partnerA", "partnerB", "both"] },
        due: { type: "string", description: "YYYY-MM-DD when known, otherwise empty string" },
        category: { type: "string", enum: ["Home", "Family", "Money", "Health", "Relationship", "Admin", "Business", "Wedding"] },
        project: { type: "string" },
        success: { type: "string" },
        notes: { type: "string", description: "Useful task details such as a grocery list, pickup instructions, links, or prep notes." }
      },
      required: ["title", "owner", "category"]
    }
  },
  {
    type: "function",
    name: "create_project",
    description: "Create a CoupleOS project chat and optional subtask chats for multi-step work.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        name: { type: "string" },
        summary: { type: "string" },
        owner: { type: "string", enum: ["partnerA", "partnerB", "both"] },
        due: { type: "string", description: "YYYY-MM-DD when known, otherwise empty string" },
        category: { type: "string", enum: ["Home", "Family", "Money", "Health", "Relationship", "Admin", "Business", "Wedding"] },
        recurrence: { type: "string", enum: ["none", "daily", "weekly", "biweekly", "monthly", "quarterly"], description: "How often the project chat will be reused. Use none for one-time projects like a wedding." },
        subtasks: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              title: { type: "string" },
              owner: { type: "string", enum: ["partnerA", "partnerB", "both"] },
              due: { type: "string" },
              category: { type: "string", enum: ["Home", "Family", "Money", "Health", "Relationship", "Admin", "Business", "Wedding"] },
              success: { type: "string" },
              notes: { type: "string" }
            },
            required: ["title", "owner"]
          }
        }
      },
      required: ["name", "owner", "category"]
    }
  },
  {
    type: "function",
    name: "draft_calendar_event",
    description: "Create a local Google Calendar draft for later sync or approval.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        title: { type: "string" },
        calendar: { type: "string", enum: ["partnerA", "partnerB", "both"] },
        start: { type: "string", description: "ISO-like local datetime, for example 2026-05-07T09:00" },
        end: { type: "string", description: "ISO-like local datetime, for example 2026-05-07T09:30" },
        location: { type: "string" },
        notes: { type: "string" }
      },
      required: ["title", "calendar", "start", "end"]
    }
  },
  {
    type: "function",
    name: "update_calendar_event",
    description: "Update an existing local calendar draft by event id or title. If no match exists, the app can create a new draft.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        eventId: { type: "string" },
        title: { type: "string" },
        calendar: { type: "string", enum: ["partnerA", "partnerB", "both"] },
        start: { type: "string" },
        end: { type: "string" },
        location: { type: "string" },
        notes: { type: "string" },
        status: { type: "string" }
      },
      required: []
    }
  }
];

function json(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

async function readJson(request) {
  let body = "";
  for await (const chunk of request) body += chunk;
  return body ? JSON.parse(body) : {};
}

function outputText(apiResponse) {
  if (apiResponse.output_text) return apiResponse.output_text;
  const parts = [];
  for (const item of apiResponse.output || []) {
    if (item.type === "message") {
      for (const content of item.content || []) {
        if (content.type === "output_text" || content.type === "text") parts.push(content.text);
      }
    }
  }
  return parts.join("\n").trim();
}

function toolCalls(apiResponse) {
  return (apiResponse.output || []).filter((item) => item.type === "function_call");
}

function safeJson(value) {
  try {
    return JSON.parse(value || "{}");
  } catch {
    return {};
  }
}

function executeTool(call) {
  const args = safeJson(call.arguments);
  const action = { type: call.name, payload: args };
  return {
    action,
    output: JSON.stringify({ ok: true, queuedAction: action })
  };
}

async function callResponses(payload) {
  const apiResponse = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const text = await apiResponse.text();
  const data = text ? JSON.parse(text) : {};
  if (!apiResponse.ok) {
    const message = data.error?.message || `OpenAI request failed with ${apiResponse.status}`;
    throw new Error(message);
  }
  return data;
}


function handleConfig(_request, response) {
  json(response, 200, {
    googleClientId: process.env.GOOGLE_CLIENT_ID || "",
    googleApiKey: process.env.GOOGLE_API_KEY || "",
    googleConfigured: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_API_KEY)
  });
}
async function handleChat(request, response) {
  if (!process.env.OPENAI_API_KEY) {
    json(response, 503, {
      message: "OpenAI is not configured yet. Start the local server with OPENAI_API_KEY set, then reload the app.",
      actions: [],
      configured: false
    });
    return;
  }

  const body = await readJson(request);
  const context = body.context || {};
  const userText = String(body.message || "").slice(0, 8000);
  const instructions = [
    "You are CoupleOS, a calm ChatGPT-style executive assistant for a couple.",
    "Keep the mood light, practical, and collaborative.",
    "When the user asks you to make or change tasks, projects, or calendar events, call the matching function tool.",
    "Put grocery lists, pickup details, links, prep details, or other supporting context into task notes.",
    "For projects, set recurrence to none for one-time projects and weekly/monthly/etc. when the chat will be reused on that rhythm.",
    "Calendar tools create or update local drafts for approval; do not claim a Google event was synced unless the app context says it was.",
    "For disagreements, recommend a fair next step that protects both partners' interests without therapy jargon.",
    "Prefer short, useful replies. Mention created actions naturally."
  ].join("\n");

  const input = [
    {
      role: "user",
      content: JSON.stringify({ userText, appContext: context })
    }
  ];

  const first = await callResponses({
    model: openAiModel,
    instructions,
    input,
    tools: appTools,
    tool_choice: "auto"
  });

  const calls = toolCalls(first);
  const executed = calls.map(executeTool);
  let final = first;

  if (executed.length) {
    final = await callResponses({
      model: openAiModel,
      instructions,
      previous_response_id: first.id,
      input: executed.map((item, index) => ({
        type: "function_call_output",
        call_id: calls[index].call_id,
        output: item.output
      })),
      tools: appTools,
      tool_choice: "auto"
    });
  }

  json(response, 200, {
    message: outputText(final) || outputText(first) || "Done.",
    actions: executed.map((item) => item.action),
    model: openAiModel,
    configured: true
  });
}

createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://localhost");

    if (request.method === "OPTIONS") {
      response.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
      });
      response.end();
      return;
    }

    if (url.pathname === "/api/config" && request.method === "GET") {
      handleConfig(request, response);
      return;
    }

    if (url.pathname === "/api/chat" && request.method === "POST") {
      await handleChat(request, response);
      return;
    }

    const requestedPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
    const filePath = normalize(join(root, requestedPath));
    if (!filePath.startsWith(root)) throw new Error("Blocked path");
    const body = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": types[extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    response.end(body);
  } catch (error) {
    if (request.url?.startsWith("/api/")) {
      json(response, 500, { message: error.message || "Server error", actions: [] });
      return;
    }
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
}).listen(port, "0.0.0.0", () => {
  console.log(`CouplesOS running at http://localhost:${port}`);
  console.log(process.env.OPENAI_API_KEY ? `OpenAI enabled with ${openAiModel}` : "OpenAI disabled: set OPENAI_API_KEY to enable live chat.");
});
