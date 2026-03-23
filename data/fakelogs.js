const fs = require("fs");
const path = require("path");

const envPath = path.join(__dirname, "logs.env");
const env = loadEnvFile(envPath);

const endpointUrl = env.endpoint_url;
const apiKey = env.api_key;
const accountId = env.account_id;

const args = parseArgs(process.argv.slice(2));
const count = Number.isInteger(args.count) && args.count > 0 ? args.count : 100;
const intervalMs =
  Number.isInteger(args.intervalMs) && args.intervalMs >= 0
    ? args.intervalMs
    : 3000;
const dryRun = args.dryRun === true;

validateConfig({ endpointUrl, apiKey, accountId });

run().catch((error) => {
  console.error("Failed to generate fake logs:", error);
  process.exitCode = 1;
});

async function run() {
  for (let index = 0; index < count; index += 1) {
    const level = Math.random() < 0.5 ? "info" : "warn";
    const body = createPayload(level);

    if (dryRun) {
      console.log(`DRY RUN ${index + 1}/${count}: ${body}`);
    } else {
      const response = await fetch(endpointUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accountId}:${apiKey}`,
        },
        body,
      });

      if (!response.ok) {
        const responseBody = await response.text();
        throw new Error(`HTTP ${response.status}: ${responseBody}`);
      }

      console.log(`Pushed fake log ${index + 1}/${count} with level=${level}`);
    }

    if (index < count - 1 && intervalMs > 0) {
      await sleep(intervalMs);
    }
  }
}

function createPayload(level) {
  return JSON.stringify({
    streams: [
      {
        stream: {
          component: "jwt-pizza-service",
          level,
          type: "http-req",
        },
        values: [
          [
            `${Date.now() * 1000000}`,
            JSON.stringify({
              name: "hacker",
              email: "d@jwt.com",
              password: "****",
            }),
            {
              user_id: "44",
              traceID: "9bc86924d069e9f8ccf09192763f1120",
            },
          ],
        ],
      },
    ],
  });
}

function loadEnvFile(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split(/\r?\n/);
  const values = {};

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    values[key] = value;
  }

  return values;
}

function validateConfig(config) {
  const missing = Object.entries(config)
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length > 0) {
    throw new Error(
      `Missing required values in logs.env: ${missing.join(", ")}`,
    );
  }
}

function parseArgs(argv) {
  const parsed = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--count") {
      parsed.count = Number.parseInt(argv[index + 1], 10);
      index += 1;
    } else if (arg === "--interval-ms") {
      parsed.intervalMs = Number.parseInt(argv[index + 1], 10);
      index += 1;
    } else if (arg === "--dry-run") {
      parsed.dryRun = true;
    }
  }

  return parsed;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
