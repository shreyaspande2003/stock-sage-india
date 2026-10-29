// Rate limiter utility — token bucket algorithm
class RateLimiter {
  constructor(maxRequests, windowMs) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
    this.tokens = maxRequests;
    this.lastRefill = Date.now();
  }

  refill() {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    const tokensToAdd = Math.floor(elapsed / this.windowMs) * this.maxRequests;
    if (tokensToAdd > 0) {
      this.tokens = Math.min(this.maxRequests, this.tokens + tokensToAdd);
      this.lastRefill = now;
    }
  }

  async acquire() {
    this.refill();
    if (this.tokens > 0) {
      this.tokens--;
      return true;
    }
    // Wait and retry
    const waitTime = this.windowMs - (Date.now() - this.lastRefill);
    await new Promise((resolve) => setTimeout(resolve, Math.max(waitTime, 100)));
    this.refill();
    if (this.tokens > 0) {
      this.tokens--;
      return true;
    }
    return false;
  }
}

// Pre-configured limiters
const limiters = {
  yahooFinance: new RateLimiter(20, 1000), // 20 req/sec for fast batch loading
  googleNews: new RateLimiter(2, 1000),    // 2 req/sec
  reddit: new RateLimiter(3, 1000),        // 3 req/sec
  gemini: new RateLimiter(10, 60000),      // 10 req/min
};

module.exports = { RateLimiter, limiters };
