/**
 * 服务端日志（P1-9 pino）。
 *
 * 开发模式走 pino-pretty（终端可读），生产模式输出结构化 JSON（便于收集/检索）。
 * 本模块不依赖 server 内其他模块（避免与 env.ts 形成循环：env.ts 的告警也走这里）。
 */
import { pino } from "pino";

const isProd = process.env.NODE_ENV === "production";

export const logger = pino({
  level: isProd ? "info" : "debug",
  ...(isProd
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "SYS:HH:MM:ss" }
        }
      })
});
