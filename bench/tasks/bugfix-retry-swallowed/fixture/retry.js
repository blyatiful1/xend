function fetchWithRetry(operation, maxAttempts) {
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return operation();
    } catch (err) {
      lastError = err;
      return null; // BUG: this should let the loop continue to the next attempt
    }
  }
  throw lastError;
}

module.exports = { fetchWithRetry };
