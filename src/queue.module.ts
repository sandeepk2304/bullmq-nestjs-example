import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { SummariesService } from "./summaries.service.js";

@Module({
  imports: [
    BullModule.forRoot({
      connection: { host: process.env.REDIS_HOST ?? "127.0.0.1", port: Number(process.env.REDIS_PORT ?? 6379) },
    }),
    BullModule.registerQueue({ name: "summaries" }),
  ],
  providers: [SummariesService],
  exports: [SummariesService, BullModule],
})
export class QueueModule {}
