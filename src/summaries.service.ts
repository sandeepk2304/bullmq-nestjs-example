import { InjectQueue } from "@nestjs/bullmq";
import { Injectable } from "@nestjs/common";
import { Queue } from "bullmq";

@Injectable()
export class SummariesService {
  constructor(@InjectQueue("summaries") private readonly queue: Queue) {}

  enqueue(documentId: number) {
    return this.queue.add("summarize", { documentId }, {
      jobId: `summary-${documentId}`,
      attempts: 4,
      backoff: { type: "exponential", delay: 1_000, jitter: 0.5 },
      removeOnComplete: { age: 24 * 3600, count: 1_000 },
      removeOnFail: { age: 7 * 24 * 3600 },
    });
  }
}
