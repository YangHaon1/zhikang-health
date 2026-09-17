import { getPluginsList } from "./build/plugins.ts";
import { include, exclude } from "./build/optimize.ts";
import { type UserConfigExport, type ConfigEnv, loadEnv } from "vite";
import {
  root,
  alias,
  wrapperEnv,
  pathResolve,
  __APP_INFO__
} from "./build/utils.ts";

export default async ({ mode }: ConfigEnv): Promise<UserConfigExport> => {
  const { VITE_CDN, VITE_PORT, VITE_COMPRESSION, VITE_PUBLIC_PATH } =
    wrapperEnv(loadEnv(mode, root));
  return {
    base: VITE_PUBLIC_PATH,
    root,
    resolve: {
      alias
    },
    // 服务端渲染
    server: {
      // 端口号
      port: VITE_PORT,
      host: "0.0.0.0",
      // 本地跨域代理 https://cn.vitejs.dev/config/server-options.html#server-proxy
      proxy: {
        "/api": {
          target: "http://localhost:3000",
          changeOrigin: true
        },
        // 头像等上传文件的静态目录（服务端 express.static 托管 server/data/uploads），
        // 不走代理的话 dev 下 <img src="/uploads/xxx"> 会落到 vite 上 404
        "/uploads": {
          target: "http://localhost:3000",
          changeOrigin: true
        }
        // 说明（B6）：方案 B 的 AI 大模型改由后端直连（server/src/llm.ts，Key 在 server/.env），
        // 前端不再持有 Key，原先的 /llm-api 代理已删除。
      },
      // 预热文件以提前转换和缓存结果，降低启动期间的初始页面加载时长并防止转换瀑布
      warmup: {
        clientFiles: ["./index.html", "./src/{views,components}/*"]
      }
    },
    plugins: await getPluginsList(VITE_CDN, VITE_COMPRESSION),
    // https://cn.vitejs.dev/config/dep-optimization-options.html#dep-optimization-options
    optimizeDeps: {
      include,
      exclude
    },
    build: {
      // https://cn.vitejs.dev/guide/build.html#browser-compatibility
      target: "es2015",
      sourcemap: false,
      // 消除打包大小超过500kb警告
      chunkSizeWarningLimit: 4000,
      rolldownOptions: {
        input: {
          index: pathResolve("./index.html", import.meta.url)
        },
        // 静态资源分类打包
        output: {
          chunkFileNames: "static/js/[name]-[hash].js",
          entryFileNames: "static/js/[name]-[hash].js",
          assetFileNames: "static/[ext]/[name]-[hash].[ext]",
          // 第三方大库拆分为稳定的 vendor chunk：减小主 chunk 体积、利于浏览器长效缓存。
          // 仅拆分边界清晰、无循环依赖风险的重库；xlsx / deep-chat 已随路由级动态 import 自动分离。
          manualChunks(id) {
            if (!id.includes("node_modules")) return undefined;
            // 兼容 pnpm：node_modules/.pnpm/<pkg>@ver/node_modules/<pkg>/...，取最后一段包名
            const segments = id.split("node_modules");
            const tail = segments[segments.length - 1].replace(/^[\\/]/, "");
            const pkg = tail.startsWith("@")
              ? tail.split(/[\\/]/).slice(0, 2).join("/")
              : tail.split(/[\\/]/)[0];
            if (/^(echarts|zrender)([\\/]|$)/.test(pkg))
              return "vendor-echarts";
            if (/^(@element-plus[\\/]|element-plus)/.test(pkg))
              return "vendor-element";
            if (/^(vxe-|xe-utils)/.test(pkg)) return "vendor-vxe";
            return undefined;
          }
        },
        checks: {
          pluginTimings: false,
          toleratedTransform: false
        }
      }
    },
    define: {
      __INTLIFY_PROD_DEVTOOLS__: false,
      __APP_INFO__: JSON.stringify(__APP_INFO__)
    }
  };
};
