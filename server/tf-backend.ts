import * as tf from "@tensorflow/tfjs";
import { setWasmPaths } from "@tensorflow/tfjs-backend-wasm";
import * as path from "path";

/**
 * TensorFlow backend initialization, shared by every face-detection consumer.
 *
 * Why WASM rather than the native @tensorflow/tfjs-node binding: tfjs-node 4.x
 * (including the 4.23 release candidate) calls `util.isNullOrUndefined`, which
 * Node removed in v23. The resulting TypeError is thrown from inside the kernel
 * backend and escapes even a direct `.catch()`, killing the process — so on any
 * current Node there is no way for application code to survive it. The WASM
 * backend is pure JS plus a `.wasm` binary, has no native build step, and runs
 * on every supported Node version.
 *
 * Trade-off: WASM inference is slower than the native binding. This pipeline is
 * I/O-bound on vision API calls, so detection time is not the bottleneck.
 */

let initPromise: Promise<void> | null = null;

async function initialize(): Promise<void> {
  // Resolve the .wasm binaries from node_modules. Without this the backend
  // tries to fetch them from a CDN, which fails offline and in CI.
  const wasmDir =
    path.join(process.cwd(), "node_modules", "@tensorflow", "tfjs-backend-wasm", "dist") +
    path.sep;
  setWasmPaths(wasmDir);

  await tf.setBackend("wasm");
  await tf.ready();

  const backend = tf.getBackend();
  if (backend !== "wasm") {
    throw new Error(
      `Expected the wasm TensorFlow backend but got "${backend}". ` +
        "Face detection results would not be reproducible across environments.",
    );
  }
  console.log(`[tf-backend] TensorFlow ready on "${backend}" backend`);
}

/** Idempotent; concurrent callers share one initialization. */
export function ensureTfBackend(): Promise<void> {
  if (!initPromise) {
    initPromise = initialize().catch((error) => {
      // Let the next caller retry rather than caching a permanent failure.
      initPromise = null;
      throw error;
    });
  }
  return initPromise;
}

export { tf };
