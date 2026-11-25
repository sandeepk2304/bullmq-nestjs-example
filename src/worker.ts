import "reflect-metadata";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { QueueModule } from "./queue.module.js";
import { SummariesProcessor } from "./summaries.processor.js";

@Module({ imports: [QueueModule], providers: [SummariesProcessor] })
class WorkerModule {}

const app = await NestFactory.createApplicationContext(WorkerModule);
if (process.env.SHUTDOWN_HOOKS !== "0") app.enableShutdownHooks();
console.log("worker ready");
