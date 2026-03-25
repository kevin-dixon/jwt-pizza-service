const config = require("./config.js");

// Fields whose values are masked before sending to Grafana.
const SENSITIVE_KEYS = new Set([
  "password",
  "token",
  "authorization",
  "apikey",
  "api_key",
  "secret",
  "cvv",
]);

/**
 * Recursively mask values whose key is in SENSITIVE_KEYS.
 */
function sanitize(obj) {
  if (typeof obj !== "object" || obj === null) return obj;
  if (Array.isArray(obj)) return obj.map(sanitize);

  const out = {};
  for (const [key, value] of Object.entries(obj)) {
    out[key] = SENSITIVE_KEYS.has(key.toLowerCase()) ? "****" : sanitize(value);
  }
  return out;
}

/**
 * Express middleware — logs every HTTP request/response to Grafana Loki.
 * Captures: method, path, status, whether an Authorization header was present,
 * sanitized request body, and sanitized response body.
 */
function httpLogger(req, res, next) {
  const start = Date.now();
  const hasAuth = Boolean(req.headers.authorization);
  const reqBody = req.body ? sanitize(req.body) : {};

  // Intercept res.send so we can capture the outgoing body.
  const originalSend = res.send.bind(res);
  let responseBody = {};
  res.send = function (body) {
    try {
      responseBody = typeof body === "string" ? JSON.parse(body) : body;
    } catch {
      responseBody = {};
    }
    return originalSend(body);
  };

  res.on("finish", () => {
    const level =
      res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info";
    log(level, "http-req", `${req.method} ${req.path} ${res.statusCode}`, {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      authorized: hasAuth,
      reqBody: JSON.stringify(reqBody),
      resBody: JSON.stringify(sanitize(responseBody)),
      latencyMs: Date.now() - start,
    });
  });

  next();
}

/**
 * Send a single structured log entry to Grafana Loki.
 *
 * @param {'info'|'warn'|'error'} level
 * @param {string} type  e.g. 'http-req', 'sql', 'factory-req', 'exception'
 * @param {string|object} message
 * @param {object} attributes  additional key/value pairs to include in the log line
 */
function log(level, type, message, attributes = {}) {
  const line = JSON.stringify({
    message: typeof message === "string" ? message : JSON.stringify(message),
    ...attributes,
  });

  sendLogToGrafana({
    streams: [
      {
        stream: {
          component: config?.logging?.source || "jwt-pizza-service",
          level,
          type,
        },
        values: [[`${Date.now() * 1000000}`, line]],
      },
    ],
  });
}

function sendLogToGrafana(event) {
  if (
    !config?.logging?.endpointUrl ||
    !config?.logging?.accountId ||
    !config?.logging?.apiKey
  ) {
    return;
  }

  fetch(config.logging.endpointUrl, {
    method: "post",
    body: JSON.stringify(event),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.logging.accountId}:${config.logging.apiKey}`,
    },
  })
    .then((res) => {
      if (!res.ok) {
        res.text().then((text) => {
          console.error(`Failed to send log to Grafana: ${text}`);
        });
      }
    })
    .catch((err) => {
      console.error("Logger error:", err.message);
    });
}

module.exports = { log, httpLogger, sanitize };
