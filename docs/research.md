# 开源项目调研

2026-10-30 通过 GitHub API 核对星数、许可证和维护状态，阅读官方仓库和源码。

| 项目 | 当时星数 | 许可证 | 对本需求的适用性 |
|---|---:|---|---|
| [AIRI](https://github.com/moeru-ai/airi) | 50,904 | MIT | 主人格、后台独立会话、来源通知、角色记忆；维护活跃。整体是另一套客户端和运行时，不能直接装进 DSH。 |
| [Generative Agents](https://github.com/joonspk-research/generative_agents) | 22,312 | Apache-2.0 | 经历流、检索、反思和规划与本需求最接近；主要是 Python 城镇模拟，仓库最后推送为2024年。 |
| [AI Town](https://github.com/a16z-infra/ai-town) | 10,726 | MIT | 可运行的角色城镇，依赖其地图、世界和后端；引入成本高。 |
| [Letta](https://github.com/letta-ai/letta) | 25,290 | Apache-2.0 | 有状态代理与长期记忆；本机已有多套记忆插件，引入会形成额外运行时与平行记忆。 |
| [Ashley](https://github.com/alpaim/ashley) | 0 | MIT | 反思和主动系统更接近，但非高星成熟组件，Rust运行时也需大量改写。 |

下载到开发机参考目录的项目为 AIRI 和 Generative Agents，使用 sparse checkout 避免下载无关资产。AIRI 阅读了 `docs/ai/adr/2026-10-10-skills-automations-and-memory.md`、`packages/core-agent/src/runtime/recipe.ts`；Generative Agents 阅读 `reverie/backend_server/persona/cognitive_modules/reflect.py` 等反思与记忆模块。

采用的设计思想：角色人格统一；后台任务不冒充用户发言；感知、反思、打算、真实执行分别记录；结果带来源返回主会话；角色记忆与用户事实分开。

本插件未直接复制项目代码，避免把不同运行时、依赖和现成角色设定带入 DSH。对 DSH 的原生会话、已有心情和记忆接口另行实现适配。星数只表示关注度，不能代替本机兼容性与功能验证。

## 第二轮源码学习与实际采用

2026-10-30 再次核对官方资料，并新增下载 AI Town 的 `convex/agent` 源码。

| 官方来源 | 阅读的实现 | 本插件中的改进 |
|---|---|---|
| [AIRI context-registry.ts](https://github.com/moeru-ai/airi/blob/main/packages/core-agent/src/runtime/context-registry.ts) | 按来源管理 replace-self / append-self，上下文与历史分开 | 显式 supersedesIds 替代临时状态；历史日记保留 |
| [AIRI chat-orchestrator-runtime.ts](https://github.com/moeru-ai/airi/blob/main/packages/core-agent/src/runtime/chat-orchestrator-runtime.ts) | 请求独立取消、队列所有权、后台静默、notice 来源与静默回复 | 反思批次隔离、超时取消、内部通知边界、无内容时安静结束 |
| [Generative Agents retrieve.py](https://github.com/joonspk-research/generative_agents/blob/main/reverie/backend_server/persona/cognitive_modules/retrieve.py) | 近期性、重要性、相关性共同决定检索 | 历史目录兼顾近期、重要与未完成打算，再由 Gemini 选择相关旧记录 |
| [AI Town memory.ts](https://github.com/a16z-infra/ai-town/blob/main/convex/agent/memory.ts) | 反思关联 contributing memory IDs；积累经历后反思 | 事件时间线、focusIds/recallIds、明确证据关系，而不只保留最近4条 |
| [Letta Memory & dreaming 官方文档](https://docs.letta.com/configuration/memory) | 后台处理记忆、提出更新后再审核 | 保持生成与审核分离；新增可恢复阶段检查点，不把未审核生成送入正式状态 |

没有照搬 AI Town 的固定500分触发阈值、额外向量数据库或其他项目的人物设定。现有 DSH 记忆插件继续负责长期记忆；本轮改进为原创适配代码，没有复制第三方源码。
