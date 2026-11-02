/** Runs async tasks strictly one after another; a failing task doesn't block later ones. */
export function createQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  return function run<T>(task: () => Promise<T>): Promise<T> {
    const p = tail.then(task, task);
    tail = p.catch(() => {});
    return p;
  };
}
