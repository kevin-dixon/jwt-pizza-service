const os = require("os");
const config = require("./config.js");

const httpMetrics = {
  total: 0,
  byMethod: {},
  endpointLatencyMs: {},
  endpointSamples: {},
};

const authMetrics = {
  success: 0,
  failed: 0,
};

const pizzaMetrics = {
  sold: 0,
  failed: 0,
  revenue: 0,
  latencyMsTotal: 0,
  latencySamples: 0,
};

const activeUsers = new Set();

let reporterTimer = null;
let previousCpuSample = null;

function sampleCpuTimes() {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;

  for (const cpu of cpus) {
    idle += cpu.times.idle;
    total +=
      cpu.times.user +
      cpu.times.nice +
      cpu.times.sys +
      cpu.times.irq +
      cpu.times.idle;
  }

  return { idle, total };
}

function requestTracker(req, res, next) {
  const start = Date.now();

  res.on("finish", () => {
    httpMetrics.total += 1;
    httpMetrics.byMethod[req.method] =
      (httpMetrics.byMethod[req.method] || 0) + 1;

    const endpoint = `[${req.method}] ${req.path}`;
    const latency = Date.now() - start;
    httpMetrics.endpointLatencyMs[endpoint] =
      (httpMetrics.endpointLatencyMs[endpoint] || 0) + latency;
    httpMetrics.endpointSamples[endpoint] =
      (httpMetrics.endpointSamples[endpoint] || 0) + 1;
  });

  next();
}

function authAttempt(success) {
  if (success) {
    authMetrics.success += 1;
  } else {
    authMetrics.failed += 1;
  }
}

function userLoggedIn(userId) {
  if (userId) {
    activeUsers.add(String(userId));
  }
}

function userLoggedOut(userId) {
  if (userId) {
    activeUsers.delete(String(userId));
  }
}

function pizzaPurchase(success, latencyMs, totalPrice, pizzaCount) {
  pizzaMetrics.latencyMsTotal += Math.max(0, Number(latencyMs) || 0);
  pizzaMetrics.latencySamples += 1;

  if (success) {
    pizzaMetrics.sold += Math.max(0, Number(pizzaCount) || 0);
    pizzaMetrics.revenue += Math.max(0, Number(totalPrice) || 0);
  } else {
    pizzaMetrics.failed += 1;
  }
}

function getCpuUsagePercentage() {
  const currentSample = sampleCpuTimes();

  if (!previousCpuSample) {
    previousCpuSample = currentSample;
    return 0;
  }

  const idleDelta = currentSample.idle - previousCpuSample.idle;
  const totalDelta = currentSample.total - previousCpuSample.total;
  previousCpuSample = currentSample;

  if (totalDelta <= 0) {
    return 0;
  }

  const usage = (1 - idleDelta / totalDelta) * 100;
  return Math.max(0, Math.min(100, Math.round(usage)));
}

function getMemoryUsagePercentage() {
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  const usedMemory = totalMemory - freeMemory;
  return Math.max(0, Math.round((usedMemory / totalMemory) * 100));
}

function createMetric(
  metricName,
  metricValue,
  metricUnit,
  metricType,
  attributes = {},
) {
  const fullAttributes = { ...attributes, source: config.metrics.source };
  const numericValue = Number(metricValue) || 0;
  const valueKey = Number.isInteger(numericValue) ? "asInt" : "asDouble";
  const dataPoint = {
    timeUnixNano: Date.now() * 1000000,
    attributes: [],
  };
  dataPoint[valueKey] = numericValue;

  Object.keys(fullAttributes).forEach((key) => {
    dataPoint.attributes.push({
      key,
      value: { stringValue: String(fullAttributes[key]) },
    });
  });

  const metric = {
    name: metricName,
    [metricType]: {
      dataPoints: [dataPoint],
    },
  };

  if (metricUnit) {
    metric.unit = metricUnit;
  }

  if (metricType === "sum") {
    metric[metricType].aggregationTemporality =
      "AGGREGATION_TEMPORALITY_CUMULATIVE";
    metric[metricType].isMonotonic = true;
  }

  return metric;
}

function buildMetricBatch() {
  const metrics = [];

  metrics.push(
    createMetric("requests", httpMetrics.total, "1", "sum", { method: "ALL" }),
  );
  Object.keys(httpMetrics.byMethod).forEach((method) => {
    metrics.push(
      createMetric("requests", httpMetrics.byMethod[method], "1", "sum", {
        method,
      }),
    );
  });

  metrics.push(
    createMetric("auth_attempts", authMetrics.success, "1", "sum", {
      result: "success",
    }),
  );
  metrics.push(
    createMetric("auth_attempts", authMetrics.failed, "1", "sum", {
      result: "failed",
    }),
  );
  metrics.push(
    createMetric("active_users_count", activeUsers.size, "", "gauge"),
  );

  metrics.push(createMetric("pizzas_sold", pizzaMetrics.sold, "1", "sum"));
  metrics.push(
    createMetric("pizza_creation_failures", pizzaMetrics.failed, "1", "sum"),
  );
  metrics.push(createMetric("pizza_revenue", pizzaMetrics.revenue, "1", "sum"));
  metrics.push(
    createMetric(
      "pizza_creation_latency",
      pizzaMetrics.latencyMsTotal,
      "ms",
      "sum",
    ),
  );
  metrics.push(
    createMetric(
      "pizza_creation_latency_samples",
      pizzaMetrics.latencySamples,
      "1",
      "sum",
    ),
  );

  Object.keys(httpMetrics.endpointLatencyMs).forEach((endpoint) => {
    metrics.push(
      createMetric(
        "endpoint_latency",
        httpMetrics.endpointLatencyMs[endpoint],
        "ms",
        "sum",
        { endpoint },
      ),
    );
    metrics.push(
      createMetric(
        "endpoint_latency_samples",
        httpMetrics.endpointSamples[endpoint],
        "1",
        "sum",
        { endpoint },
      ),
    );
  });

  metrics.push(createMetric("cpu", getCpuUsagePercentage(), "%", "gauge"));
  metrics.push(
    createMetric("memory", getMemoryUsagePercentage(), "%", "gauge"),
  );

  return metrics;
}

function sendMetricsToGrafana(metrics) {
  if (
    !config?.metrics?.endpointUrl ||
    !config?.metrics?.accountId ||
    !config?.metrics?.apiKey
  ) {
    return;
  }

  const body = {
    resourceMetrics: [
      {
        scopeMetrics: [
          {
            metrics,
          },
        ],
      },
    ],
  };

  fetch(config.metrics.endpointUrl, {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      Authorization: `Bearer ${config.metrics.accountId}:${config.metrics.apiKey}`,
      "Content-Type": "application/json",
    },
  }).catch((error) => {
    // Avoid crashing request flow if telemetry endpoint is temporarily unavailable.
    console.error("Error pushing metrics:", error.message);
  });
}

function startReporting(periodMs = 10000) {
  if (reporterTimer || process.env.NODE_ENV === "test") {
    return;
  }

  reporterTimer = setInterval(() => {
    try {
      sendMetricsToGrafana(buildMetricBatch());
    } catch (error) {
      console.error("Error sending metrics:", error.message);
    }
  }, periodMs);
}

module.exports = {
  requestTracker,
  authAttempt,
  userLoggedIn,
  userLoggedOut,
  pizzaPurchase,
  startReporting,
};
