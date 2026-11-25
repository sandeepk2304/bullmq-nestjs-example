import { OnWorkerEvent, Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import { Job, RateLimitError, UnrecoverableError } from "bullmq";

// Defaults are the settings from the post. The env vars exist so bench/ can vary one at a time.
const concurrency = Number(process.env.CONCURRENCY ?? 10);
const limiter = process.env.LIMIT_MAX === "0"
  ? undefined
  : { max: Number(process.env.LIMIT_MAX ?? 1), duration: Number(process.env.LIMIT_MS ?? 125) };

@Processor("summaries", { concurrency, limiter })
export class SummariesProcessor extends WorkerHost {
  private readonly log = new Logger(SummariesProcessor.name);

  async process(job: Job<{ documentId: number }>) {
    const res = await fetch(`${process.env.LLM_URL}/v1/summarize`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(job.data),
      signal: AbortSignal.timeout(60_000),
    });
    if (res.status === 429 && process.env.PAUSE_ON_429 !== "0") {
      await this.worker.rateLimit(Number(res.headers.get("retry-after") ?? 1) * 1_000);
      throw new RateLimitError();
    }
    if (res.status === 400) throw new UnrecoverableError("bad request");
    if (!res.ok) throw new Error(`model API returned ${res.status}`);
    return res.json();
  }

  @OnWorkerEvent("failed")
  onFailed(job: Job | undefined, err: Error) {
    this.log.error(`${job?.id} attempt ${job?.attemptsMade}: ${err.message}`);
  }
}
