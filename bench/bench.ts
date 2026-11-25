// node dist/bench/bench.js concurrency | limiter | shutdown
// WARNING: obliterates the "summaries" queue on the Redis it points at. Use a throwaway Redis.
import { spawn, type ChildProcess } from "node:child_process";
import http from "node:http";
import { setTimeout as sleep } from "node:timers/promises";
import { Queue } from "bullmq";

const connection = { host: process.env.REDIS_HOST ?? "127.0.0.1", port: Number(process.env.REDIS_PORT ?? 6379) };
const API_PORT = 4555;

// Fake model API: `cap` calls in any rolling second, each taking `latency` ms.
let cap = Infinity;
let latency = 500;
let hits: { at: number; code: number }[] = [];
let accepted: number[] = [];
const api = http.createServer((req, res) => {
  req.resume().on("end", () => {
    const now = Date.now();
    accepted = accepted.filter((t) => t > now - 1_000);
    const code = accepted.length >= cap ? 429 : 200;
    hits.push({ at: now, code });
    if (code === 429) return void res.writeHead(429, { "retry-after": "1" }).end("{}");
    accepted.push(now);
    setTimeout(() => res.writeHead(200, { "content-type": "application/json" }).end('{"ok":true}'), latency);
  });
}).listen(API_PORT);

const queue = new Queue("summaries", { connection });
const jobOpts = { attempts: 4, backoff: { type: "exponential", delay: 1_000, jitter: 0.5 } };

async function startWorker(env: Record<string, string>): Promise<ChildProcess> {
  const p = spawn("node", ["dist/src/worker.js"], {
    env: { ...process.env, LLM_URL: `http://127.0.0.1:${API_PORT}`, ...env },
    stdio: ["ignore", "pipe", "ignore"],
  });
  await new Promise<void>((r) => p.stdout!.on("data", (d) => String(d).includes("worker ready") && r()));
  return p;
}
async function stop(p: ChildProcess, signal: NodeJS.Signals) {
  const exited = new Promise((r) => p.once("exit", r));
  p.kill(signal);
  await exited;
}
async function reset(newCap: number, newLatency: number) {
  await queue.obliterate({ force: true });
  hits = []; accepted = []; cap = newCap; latency = newLatency;
}

async function run(label: string, jobs: number, workers: number, env: Record<string, string>, limit = Infinity) {
  await reset(limit, 500);
  const ps = await Promise.all(Array.from({ length: workers }, () => startWorker(env)));
  const t = Date.now();
  await queue.addBulk(Array.from({ length: jobs }, (_, i) => ({ name: "summarize", data: { documentId: i }, opts: jobOpts })));
  let c: Record<string, number>;
  do { await sleep(25); c = await queue.getJobCounts("completed", "failed"); } while (c.completed + c.failed < jobs);
  console.log(label, { seconds: (Date.now() - t) / 1000, ...c, rejected429: hits.filter((h) => h.code === 429).length });
  await Promise.all(ps.map((p) => stop(p, "SIGKILL")));
}

async function shutdown(label: string, signal: NodeJS.Signals, hooks: string) {
  await reset(Infinity, 5_000);
  const env = { CONCURRENCY: "1", LIMIT_MAX: "0", SHUTDOWN_HOOKS: hooks };
  const first = await startWorker(env);
  await queue.add("summarize", { documentId: 1 }, jobOpts);
  while (!hits.length) await sleep(20);
  await sleep(1_000);
  const t = Date.now();
  await stop(first, signal);
  const exitMs = Date.now() - t;
  const second = await startWorker(env);
  while (!(await queue.getJobCounts("completed")).completed) await sleep(25);
  console.log(label, { exitMs, apiCalls: hits.length, restartedAfterSec: hits[1] ? (hits[1].at - t) / 1000 : null });
  await stop(second, "SIGKILL");
}

const mode = process.argv[2];
if (mode === "concurrency") {
  for (const n of ["1", "5", "10", "20"]) await run(`concurrency ${n}`, 60, 1, { CONCURRENCY: n, LIMIT_MAX: "0" });
} else if (mode === "limiter") {
  const base = { CONCURRENCY: "20", PAUSE_ON_429: "0" };
  for (const [max, ms] of [["0", "0"], ["10", "1000"], ["8", "1000"], ["1", "100"], ["1", "125"]])
    await run(max === "0" ? "no limiter" : `max ${max} per ${ms} ms`, 100, 2, { ...base, LIMIT_MAX: max, LIMIT_MS: ms }, 10);
} else if (mode === "shutdown") {
  await shutdown("SIGTERM, hooks off", "SIGTERM", "0");
  await shutdown("SIGTERM, hooks on", "SIGTERM", "1");
  await shutdown("SIGKILL", "SIGKILL", "1");
} else {
  console.error("usage: bench concurrency | limiter | shutdown");
}
await queue.close();
api.close();
process.exit(0);
