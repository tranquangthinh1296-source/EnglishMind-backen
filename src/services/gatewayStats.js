// In-memory AI gateway stats for /api/gateway/status (beta diagnostics).
// Resets on process restart — sufficient for ops visibility during beta.

let totalCalls = 0;
let successCalls = 0;

function recordCall(success) {
  totalCalls += 1;
  if (success) successCalls += 1;
}

function snapshot() {
  return {
    totalCalls,
    successCalls,
    successRate: totalCalls > 0 ? successCalls / totalCalls : null,
  };
}

module.exports = { recordCall, snapshot };
