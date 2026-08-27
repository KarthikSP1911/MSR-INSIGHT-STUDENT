/**
 * Runs `fn` over `items` with at most `limit` calls in flight at once.
 * Used to cap the scraper's fan-out of parallel HTTP requests against the
 * portal, instead of firing all of them at once (unbounded parallelism risks
 * rate-limiting/blocking on a single third-party host).
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await fn(items[index], index);
    }
  });

  await Promise.all(workers);
  return results;
}
