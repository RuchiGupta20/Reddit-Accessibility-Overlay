const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const envPath = path.join(projectRoot, ".env.local");
loadEnvFile(envPath);

const apiKey = process.env.GROQ_API_KEY;
const model = process.env.GROQ_MODEL || "llama-3.1-8b-instant";
const port = Number(process.env.SUMMARY_SERVER_PORT || 8787);

if (!apiKey) {
  console.error("Missing GROQ_API_KEY. Create a .env.local file from .env.local.example first.");
  process.exit(1);
}

const server = http.createServer(async (request, response) => {
  setCorsHeaders(response);

  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  if (request.method === "GET" && request.url === "/health") {
    writeJson(response, 200, {
      ok: true,
      model
    });
    return;
  }

  if (request.method === "POST" && request.url === "/summarize") {
    try {
      const body = await readJsonBody(request);
      const summary = await summarizeThread(body);

      writeJson(response, 200, {
        summary
      });
    } catch (error) {
      writeJson(response, 500, {
        error: error instanceof Error ? error.message : "Unexpected server error."
      });
    }

    return;
  }

  writeJson(response, 404, {
    error: "Not found."
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Reddit summarization server listening on http://127.0.0.1:${port}`);
});

function setCorsHeaders(response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function writeJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(payload));
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const file = fs.readFileSync(filePath, "utf8");
  const lines = file.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();

    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

async function readJsonBody(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8");

  if (!raw) {
    return {};
  }

  return JSON.parse(raw);
}

async function summarizeThread(payload) {
  const title = normalizeText(payload?.title);
  const body = normalizeText(payload?.body);
  const comments = Array.isArray(payload?.comments)
    ? payload.comments.map(normalizeText).filter(Boolean).slice(0, 20)
    : [];
  const url = normalizeText(payload?.url);

  if (!title && !body && comments.length === 0) {
    throw new Error("No Reddit content was collected to summarize.");
  }

  const prompt = [
    "You summarize Reddit threads for accessibility and quick reading.",
    "Write plain, concise English.",
    "Use exactly these sections:",
    "Post summary:",
    "- 2 to 4 bullet points covering the main idea and important context.",
    "Comment highlights:",
    "- 3 to 6 bullet points covering notable discussion themes, disagreements, useful advice, or repeated concerns.",
    "Skip fluff, jokes, and duplicate comments unless they matter to the discussion.",
    "",
    `URL: ${url || "Unknown"}`,
    `Post title: ${title || "Untitled post"}`,
    `Post body: ${body || "No body text found."}`,
    "",
    "Top comments:",
    comments.length > 0 ? comments.map((comment, index) => `${index + 1}. ${comment}`).join("\n") : "No comments found."
  ].join("\n");

  let apiResponse;

  try {
    apiResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content: "You summarize Reddit threads for accessibility and quick reading. Write plain, concise English."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.3,
        max_tokens: 500
      })
    });
  } catch (error) {
    throw new Error(`Unable to reach the Groq API. ${describeError(error)}`);
  }

  const data = await apiResponse.json().catch(() => ({}));

  if (!apiResponse.ok) {
    throw new Error(data.error?.message || "Groq request failed.");
  }

  const summary = typeof data.choices?.[0]?.message?.content === "string"
    ? data.choices[0].message.content.trim()
    : "";

  if (!summary) {
    throw new Error("Groq returned an empty summary.");
  }

  return summary;
}

function normalizeText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function describeError(error) {
  if (!(error instanceof Error)) {
    return "Unknown network error.";
  }

  const causeCode = error.cause && typeof error.cause === "object" && "code" in error.cause
    ? String(error.cause.code)
    : "";

  return causeCode ? `${error.message} (${causeCode})` : error.message;
}
