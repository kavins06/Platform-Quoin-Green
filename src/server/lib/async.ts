export async function mapWithConcurrency<TInput, TOutput>(
  items: readonly TInput[],
  concurrency: number,
  worker: (item: TInput, index: number) => Promise<TOutput>,
): Promise<TOutput[]> {
  if (items.length === 0) {
    return [];
  }

  const safeConcurrency = Math.max(1, Math.min(concurrency, items.length));
  const results = new Array<TOutput>(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      if (currentIndex >= items.length) {
        return;
      }

      results[currentIndex] = await worker(items[currentIndex]!, currentIndex);
    }
  }

  await Promise.all(Array.from({ length: safeConcurrency }, () => runWorker()));

  return results;
}

export async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
