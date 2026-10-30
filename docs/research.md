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
