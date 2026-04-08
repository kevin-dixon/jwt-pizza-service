if (process.env.VSCODE_INSPECTOR_OPTIONS) {
  jest.setTimeout(60 * 1000 * 5); // 5 minutes
}

function loadMetricsModule({
  nodeEnv = "development",
  metricsConfig = {
    source: "jwt-pizza-service-test",
    endpointUrl: "https://example.invalid/metrics",
    accountId: "acct",
    apiKey: "key",
  },
  cpuSamples,
  totalMemory = 100,
  freeMemory = 25,
} = {}) {
  jest.resetModules();

  process.env.NODE_ENV = nodeEnv;

  jest.doMock("./config.js", () => ({
    metrics: metricsConfig,
  }));

  let cpuIndex = 0;
  const defaultCpuSamples = [
    [{ times: { user: 100, nice: 0, sys: 0, irq: 0, idle: 100 } }],
    [{ times: { user: 150, nice: 0, sys: 0, irq: 0, idle: 150 } }],
  ];
  const selectedCpuSamples = cpuSamples || defaultCpuSamples;

  jest.doMock("os", () => ({
    cpus: jest.fn(() => {
      const sample =
        selectedCpuSamples[Math.min(cpuIndex, selectedCpuSamples.length - 1)];
      cpuIndex += 1;
      return sample;
    }),
    totalmem: jest.fn(() => totalMemory),
    freemem: jest.fn(() => freeMemory),
  }));

  return require("./metrics.js");
}

function getMetricByName(metrics, name) {
  return metrics.find((m) => m.name === name);
}

describe("metrics module", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-03-17T00:00:00.000Z"));
    global.fetch = jest.fn(() => Promise.resolve({ ok: true }));
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
    delete global.fetch;
    delete process.env.NODE_ENV;
    delete process.env.ACTIVE_USER_WINDOW_MS;
  });

  test("tracks requests, auth, active users, pizza metrics and sends OTEL payload", async () => {
    const metrics = loadMetricsModule({
      nodeEnv: "development",
      cpuSamples: [
        [{ times: { user: 100, nice: 0, sys: 0, irq: 0, idle: 100 } }],
        [{ times: { user: 180, nice: 0, sys: 0, irq: 0, idle: 120 } }],
      ],
      totalMemory: 200,
      freeMemory: 50,
    });

    const finishHandlers = [];
    const req = { method: "GET", path: "/api/order/menu" };
    const res = {
      on: (event, cb) => {
        if (event === "finish") {
          finishHandlers.push(cb);
        }
      },
    };

    const next = jest.fn();
    metrics.requestTracker(req, res, next);
    expect(next).toHaveBeenCalled();

    jest.advanceTimersByTime(42);
    finishHandlers[0]();

    metrics.authAttempt(true);
    metrics.authAttempt(false);
    metrics.userLoggedIn(123);
    metrics.userLoggedOut(123);
    metrics.userLoggedIn(456);
    metrics.pizzaPurchase(true, 120, 0.75, 3);
    metrics.pizzaPurchase(false, 80, 0, 0);

    metrics.startReporting(1000);
    await jest.advanceTimersByTimeAsync(2000);
    expect(global.fetch).toHaveBeenCalledTimes(2);

    const firstCallPayload = JSON.parse(global.fetch.mock.calls[0][1].body);
    const firstMetrics =
      firstCallPayload.resourceMetrics[0].scopeMetrics[0].metrics;

    const requestsMetric = getMetricByName(firstMetrics, "requests");
    expect(requestsMetric).toBeDefined();
    expect(requestsMetric.sum.isMonotonic).toBe(true);

    const revenueMetric = getMetricByName(firstMetrics, "pizza_revenue");
    expect(revenueMetric.sum.dataPoints[0].asDouble).toBe(0.75);

    const activeUsersMetric = getMetricByName(
      firstMetrics,
      "active_users_count",
    );
    expect(activeUsersMetric.gauge.dataPoints[0].asInt).toBe(1);

    const endpointLatencyMetric = getMetricByName(
      firstMetrics,
      "endpoint_latency",
    );
    expect(endpointLatencyMetric).toBeDefined();
    expect(endpointLatencyMetric.unit).toBe("ms");

    const memoryMetric = getMetricByName(firstMetrics, "memory");
    expect(memoryMetric.gauge.dataPoints[0].asInt).toBe(75);

    const secondCallPayload = JSON.parse(global.fetch.mock.calls[1][1].body);
    const secondMetrics =
      secondCallPayload.resourceMetrics[0].scopeMetrics[0].metrics;
    const cpuMetric = getMetricByName(secondMetrics, "cpu");
    expect(cpuMetric.gauge.dataPoints[0].asInt).toBeGreaterThan(0);
    expect(cpuMetric.gauge.dataPoints[0].asInt).toBeLessThanOrEqual(100);
  });

  test("does not send metrics when endpoint credentials are missing", async () => {
    const metrics = loadMetricsModule({
      nodeEnv: "development",
      metricsConfig: {
        source: "jwt-pizza-service-test",
      },
    });

    metrics.startReporting(500);
    await jest.advanceTimersByTimeAsync(1500);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("startReporting is disabled in test environment", async () => {
    const metrics = loadMetricsModule({ nodeEnv: "test" });

    metrics.startReporting(500);
    await jest.advanceTimersByTimeAsync(1500);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("handles zero CPU delta and logs fetch errors without throwing", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    global.fetch = jest.fn(() => Promise.reject(new Error("network down")));

    const metrics = loadMetricsModule({
      nodeEnv: "development",
      cpuSamples: [
        [{ times: { user: 100, nice: 0, sys: 0, irq: 0, idle: 100 } }],
        [{ times: { user: 100, nice: 0, sys: 0, irq: 0, idle: 100 } }],
      ],
    });

    metrics.startReporting(1000);
    await jest.advanceTimersByTimeAsync(2000);
    expect(global.fetch).toHaveBeenCalledTimes(2);

    const secondCallPayload = JSON.parse(global.fetch.mock.calls[1][1].body);
    const secondMetrics =
      secondCallPayload.resourceMetrics[0].scopeMetrics[0].metrics;
    const cpuMetric = getMetricByName(secondMetrics, "cpu");
    expect(cpuMetric.gauge.dataPoints[0].asInt).toBe(0);

    expect(errorSpy).toHaveBeenCalled();
    expect(
      errorSpy.mock.calls.some((call) =>
        String(call[0]).includes("Error pushing metrics"),
      ),
    ).toBe(true);
  });

  test("active users age out after inactivity window", async () => {
    process.env.ACTIVE_USER_WINDOW_MS = "1000";
    const metrics = loadMetricsModule({ nodeEnv: "development" });

    metrics.userSeen(999);
    metrics.startReporting(1000);
    await jest.advanceTimersByTimeAsync(3000);

    const firstCallPayload = JSON.parse(global.fetch.mock.calls[0][1].body);
    const firstMetrics =
      firstCallPayload.resourceMetrics[0].scopeMetrics[0].metrics;
    const firstActiveUsersMetric = getMetricByName(
      firstMetrics,
      "active_users_count",
    );
    expect(firstActiveUsersMetric.gauge.dataPoints[0].asInt).toBe(1);

    const thirdCallPayload = JSON.parse(global.fetch.mock.calls[2][1].body);
    const thirdMetrics =
      thirdCallPayload.resourceMetrics[0].scopeMetrics[0].metrics;
    const thirdActiveUsersMetric = getMetricByName(
      thirdMetrics,
      "active_users_count",
    );
    expect(thirdActiveUsersMetric.gauge.dataPoints[0].asInt).toBe(0);
  });
});
