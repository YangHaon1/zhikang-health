\# 项目：智康健康管理系统（后端化改造中）

\## 权威依据

\- 改造方案：项目根目录《后端化改造方案.md》，所有改动以其为准，按 B0→B10 阶段推进。

\- 每阶段只做当前阶段点名范围，完成后输出改动清单 + 验证结果，等待确认再进入下一阶段。

\## 执行契约（必须遵守）

1\. 每阶段独立 git commit，subject 用中性小写（如 feat(server): 后端骨架），禁止大写拉丁字母开头（commitlint 限制）。

2\. 删除/移动文件前先 grep 确认无引用；每阶段跑 pnpm typecheck（前端）+ curl 接口实测。

3\. 不修改与本次无关的页面视觉、文案、框架核心；只动方案点名范围。

4\. 规则引擎只能有一份源码：server/shared/health-engine.ts，禁止前端复制完整实现（可 import 分级函数）。

5\. 所有用户数据操作强制 user\_id 隔离；SQL 参数化；密码 bcrypt。

6\. 不删除 LICENSE、README、演示脚本。

\## 环境注意

\- Windows 环境，PowerShell 语法；pnpm 包管理。

\- 后端端口 3000，前端 dev 8848（vite proxy /api → 3000）。
