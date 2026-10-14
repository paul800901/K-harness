// release() and inspect() return before the account queries they start; these tests check those queries' outcome.
export const settleAfterRelease = accounts => {
  const acquire = accounts.acquire,
    inspect = accounts.inspect;
  accounts.inspect = async fn => {
    try {
      return await inspect(fn);
    } finally {
      await accounts.idle();
    }
  };
  accounts.acquire = async (...args) => {
    const lease = await acquire(...args),
      release = lease.release;
    lease.release = async (...options) => {
      try {
        return await release(...options);
      } finally {
        await accounts.idle();
      }
    };
    return lease;
  };
  return accounts;
};
