# BullMQ NestJS example

A small, tested BullMQ queue in NestJS 12: module, producer, processor, separate worker process, rate limit, graceful shutdown and a password-protected dashboard. The `bench/` folder measures what each setting changes.

The write-up, with what the numbers mean: **[BullMQ NestJS setup: concurrency, rate limits, shutdown](https://www.hisandeep.com/blog/bullmq-nestjs)**

## Run it

Needs Node 22+ and Docker (or any Redis 6.2+).

```bash
docker compose up -d
npm install
npm run build

# terminal 1: a worker. LLM_URL is any HTTP API that answers POST /v1/summarize
LLM_URL=http://localhost:4555 npm run start:worker

# terminal 2: the API and the dashboard
BOARD_PASSWORD=change-me npm run start:api
curl -X POST localhost:3000/summaries/42
```

The dashboard is at http://localhost:3000/queues (user `admin`).

## What is in it

| File | Job |
|---|---|
| `src/queue.module.ts` | Redis connection and the queue |
| `src/summaries.service.ts` | Adds jobs: attempts, backoff with jitter, `jobId` deduplication, cleanup |
| `src/summaries.processor.ts` | Runs jobs: concurrency, limiter, 429 pause, `UnrecoverableError` |
| `src/worker.ts` | Worker process with shutdown hooks |
| `src/api.ts` | HTTP API and bull-board behind basic auth |
| `bench/bench.ts` | The benchmarks below, against a fake model API |

## Measured

NestJS 12.6, BullMQ 6.7, Redis 8, one laptop (i5-1135G7), three runs each.

60 jobs of 500 ms, one worker: 30.6 s at concurrency 1, 6.3 s at 5, 3.2 s at 10, 1.8 s at 20.

100 jobs, two workers at concurrency 20, an API that allows 10 calls in any rolling second, 429 pause off:

| Limiter | 429s | Jobs lost | Time |
|---|---|---|---|
| none | 281–284 | 41–45 | 7.3 s |
| `max: 10, duration: 1000` | 34–46 | 0 | 14.6–18.3 s |
| `max: 8, duration: 1000` | 21–25 | 0 | 15.6–16.0 s |
| `max: 1, duration: 100` | 1–3 | 0 | 10.7–11.0 s |
| `max: 1, duration: 125` | 0 | 0 | 13.0–13.1 s |

Worker stopped one second into a five-second job: with `enableShutdownHooks()` the job finishes and the API is called once. Without it, or on SIGKILL, the job restarts after 61 s and the API is called twice.

Your numbers will differ a little. Run them yourself:

```bash
npm run bench concurrency
npm run bench limiter
npm run bench shutdown
```

The benchmark **deletes every job in the `summaries` queue** on the Redis it connects to. Point `REDIS_HOST` and `REDIS_PORT` at a throwaway one.

## Related

- [BullMQ vs RabbitMQ in Node.js: speed, crashes, retries](https://www.hisandeep.com/blog/bullmq-vs-rabbitmq)
- [Retries in BullMQ vs Laravel queues](https://www.hisandeep.com/blog/bullmq-vs-laravel-queue-retries)

MIT licensed. By [Sandeep Kumar](https://www.hisandeep.com).
