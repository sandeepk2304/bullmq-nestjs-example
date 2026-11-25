import "reflect-metadata";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";
import { BullBoardModule } from "@bull-board/nestjs";
import { Controller, Module, Param, ParseIntPipe, Post } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import basicAuth from "express-basic-auth";
import { QueueModule } from "./queue.module.js";
import { SummariesService } from "./summaries.service.js";

const password = process.env.BOARD_PASSWORD;
if (!password) throw new Error("Set BOARD_PASSWORD: the dashboard shows job data.");

@Controller("summaries")
class SummariesController {
  constructor(private readonly summaries: SummariesService) {}

  @Post(":documentId")
  async create(@Param("documentId", ParseIntPipe) documentId: number) {
    const job = await this.summaries.enqueue(documentId);
    return { jobId: job.id };
  }
}

@Module({
  imports: [
    QueueModule,
    BullBoardModule.forRoot({
      route: "/queues",
      adapter: ExpressAdapter,
      middleware: basicAuth({ challenge: true, users: { admin: password } }),
    }),
    BullBoardModule.forFeature({ name: "summaries", adapter: BullMQAdapter }),
  ],
  controllers: [SummariesController],
})
class ApiModule {}

const app = await NestFactory.create(ApiModule);
app.enableShutdownHooks();
await app.listen(Number(process.env.PORT ?? 3000), process.env.HOST ?? "127.0.0.1");
