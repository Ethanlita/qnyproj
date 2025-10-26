# qnyproj - 小说到漫画的AI转换平台

> 🎨 从文字到画面，让创意即刻落地
>
> 嗯，实际上创建这个repository的时候issue还没发布，就有了这么一个直男名字。

## 致七牛云评审员

感谢您审阅本项目！以下是一些关键信息，帮助您快速了解和评估本项目：

- **🚀 在线体验优先**：本项目配置了完整的 CI/CD 流程，每当有新的 commit 推送到 main 分支时，会自动部署到 GitHub Pages 和 AWS。因此，**线上版本始终保持最新**。我们强烈建议您直接访问 [https://ethanlita.github.io/qnyproj](https://ethanlita.github.io/qnyproj) 体验最新版本，而不仅仅是观看演示视频。（考虑到 AI 服务成本，线上版本需要注册账号，请通过报名信息联系项目所有者获取测试账号）

- **🤖 精选AI模型组合**：我们采用 **Qwen-Plus**（阿里云通义千问）+ **Gemini Imagen 3** (Nano Banana) 的组合方案。这是在综合考虑模型收费、质量、中文理解能力后做出的最优选择。经过大量测试，我们发现 Qwen、DeepSeek 等中国企业训练的大模型在**中文语境表达**、**情感理解**和**中文创作**方面相比国外模型具有明显优势，而 Qwen 提供的免费 Token 配额也足够支持开发和测试。在图像生成方面，Gemini 的 Nano Banana 模型经过对比测试，在漫画风格生成的美学质量上表现最佳。

- **📖 "圣经系统" **：为了确保生成的漫画在长篇作品中保持角色和场景的稳定性，我们引入了创新的**"角色圣经"**和**"场景圣经"**机制。这些圣经可以在多个不同的生成任务间持续使用和累积，确保人设和场景设定能够**跨画面、跨页面、跨章节保持一致**。同时，我们支持同一角色/场景的多个变体（如不同服装、不同状态），系统会根据上下文自动选择合适的变体，既保证了一致性又保留了灵活性。

- **🏗️ 生产级架构与工程质量**：我们从开发伊始就以**生产环境标准**要求自己。采用 **AWS Serverless 架构**（Lambda + DynamoDB + SQS + S3 + CloudFront），天然具有弹性伸缩能力，可以轻松承载大规模用户量。配备完善的测试框架（Jest 单元测试 + 集成测试，目标覆盖率 80%+），使用 TypeScript 全栈开发确保类型安全，通过 OpenAPI 规范实现前后端契约式开发，并配置了 GitHub Actions 实现 CI/CD。

- **✏️ 用户可编辑与定制化**：我们允许用户在 AI 生成的基础上**自行编辑和修改圣经内容**，并支持**上传自己的人设图**作为参考图像。这使得最终产出能够更加贴近用户心目中的期望，而不仅仅是 AI 的"一言堂"。用户可以通过自然语言指令、手动编辑圣经描述、上传参考图等多种方式精细控制生成效果。

- **📚 长篇小说支持**：由于我们实现了跨生成的人设和场景一致性保障，因此即使是**非常长的小说**（数万字甚至更长），我们也可以通过**章节化处理**来完整生成，并确保全篇的角色和场景设定保持连贯。根据目前的测试数据，5000 字左右的章节需要约 5-8 分钟完成生成（包括小说分析、分镜生成、参考图生成、面板绘制等全流程），这主要受限于 qwen-plus 的 32K Token 输出限制和 Imagen 3 的图像生成速度。

- **🎯 真实用户价值**：我们致力于保证产出的**真实可用性**，而不是仅仅一个 Demo。我们希望为两类核心用户提供价值：**漫画创作者**（快速验证创意、加速创作流程）和**小说粉丝/作者**（可视化小说世界观、创作同人漫画）。我们相信，只有真正解决用户痛点的产品才有生命力。

- **👥 关于开发流程**：由于本项目为**单人开发**，为了提高迭代效率，我们采用了直接推送到 main 分支的工作流，而没有使用 Pull Request。但这并不代表我们不懂或不支持 PR 工作流 —— 相反，在团队协作场景下，我们完全理解并推崇 PR + Code Review 的最佳实践。您可以参考我们的另一个项目 [Ethanlita/vfs-tracker](https://github.com/Ethanlita/vfs-tracker) 查看规范的 PR 使用示例。本项目的 CI/CD 配置已经为未来的团队协作预留了 PR 检查流程（TypeScript 类型检查、ESLint、单元测试等）。此外，我们在本项目的CI流程中设置了质量门，质量门会在代码质量不合格（目前会检查API一致性）时阻止进一步的CI和CD流程。

## 问题的回答

### 📊 你计划将这个产品面向什么类型的用户？这些类型的用户他们面临什么样的痛点，你设想的用户故事是什么样呢？

我们计划面向**两类核心用户**：**漫画创作者**与**小说读者/作者**。

#### 🎨 漫画创作者

**核心痛点**：
- ⏱️ **创作周期过长**：传统手绘漫画从草稿到完稿可能需要数天甚至数周，这使得快速验证创意构想变得异常困难
- 💰 **试错成本高**：投入大量时间绘制后才发现剧情或构图不理想，调整代价巨大
- 🎭 **难以快速迭代**：想要尝试不同的分镜方案、角色造型或场景设计，传统方式需要重新绘制

**我们的解决方案**：
- ⚡ **快速验证**：创作者只需写好构思的剧情文本，在 **5-8 分钟内**即可通过我们的产品将想法转化为完整的漫画分镜预览
- 🎛️ **多层次控制**：提供详细的编辑功能，允许创作者在多个环节通过**自然语言指令**精细控制生成效果（例如："把第3页第2个面板的角色表情改为微笑"）
- 🖼️ **基于自有素材**：支持上传创作者自己绘制的人设图作为参考，AI 会学习并延续创作者的个人风格
- 🔄 **快速迭代**：对不满意的面板可以单独重新生成，无需从头开始

**用户故事**：
> 独立漫画创作者小李构思了一个科幻题材的短篇故事。他将 5000 字的剧本输入系统，上传了主角的设定图，8 分钟后得到了 20 页的分镜草稿。发现第 10 页的打斗场面节奏不对，他用自然语言描述了修改需求，2 分钟后得到了新版本。整个验证过程从传统的"一周"缩短到"半小时"，极大提升了创作效率。

#### 📚 小说读者/作者

**核心痛点**：
- 📖 **世界观呈现单薄**：纯文字小说虽然提供了想象空间，但缺乏直观的视觉体验
- 🎭 **人物形象难以统一**：读者对角色的想象千差万别，作者难以传达精确的人物形象
- 💝 **粉丝向内容匮乏**：喜欢某部小说的读者想要创作同人内容，但缺乏绘画技能

**我们的解决方案**：
- 🌍 **世界观可视化**：小说作者可以为自己的作品生成配套的漫画版章节，提供更加**具象化的世界观和人物展示**
- 🎨 **人设图延伸**：现在很多在线小说作者会为角色绘制人设图，我们可以基于这些人设图生成完整的漫画场景，让"几张图片"扩展为"完整的视觉体验"
- 📈 **提升读者粘性**：为小说提供配套的视觉内容，增强读者的代入感和阅读体验
- 💖 **同人创作神器**：粉丝可以撰写自己喜欢角色的同人剧情，上传官方或自绘的人设图，生成属于自己的独家同人漫画

**用户故事**：
> 网文作者小王的奇幻小说《龙城纪事》在平台上有 10 万读者。她为主要角色绘制了 5 张人设图，但读者反馈"只有几张图还是不够过瘾"。使用本产品后，她将小说的前 3 章（每章 5000 字）转换为漫画，每章耗时约 8 分钟。这些漫画作为"番外篇"发布后，读者活跃度提升了 40%，很多读者表示"终于看到书中世界的真实样子了"。

**💝 特殊用例 - "我推"（同人创作）**：
> 动漫粉丝小张非常喜欢某部作品中的两个角色。她用文字写下了一篇 3000 字的同人故事，上传了两个角色的官方设定图作为参考。5 分钟后，一部完全属于她自己的 15 页同人漫画诞生了！她可以将这部作品分享到同人社区，或者珍藏为自己的"心头好"。这种体验，难道不是每个粉丝都梦寐以求的吗？

---

### 🛠️ 你认为这个产品实现上的挑战是什么，你计划如何应对这些挑战？

#### 挑战 1：💰 AI 生成成本高昂

**问题描述**：
- 图像生成的 API 调用费用远高于文本生成（通常是 10-100 倍）
- 一个 20 页的漫画可能需要生成 60-100 张图片（面板 + 参考图 + 重试），成本累积迅速

**解决方案 - 预览模式**：
- 📉 **低分辨率预览**：首次生成时使用 **512×288** 的低分辨率（约为高清的 10% 成本）
- ✅ **用户确认机制**：用户满意后再生成 **1920×1080** 的高清版本
- 🔄 **局部重绘**：只对不满意的面板重新生成，而不是整页重做
- 📊 **成本节省**：根据测试数据，预览模式可为用户平均节省 **70-80%** 的图像生成费用

**实施效果**：
```
传统方式：20 页漫画 × 5 面板/页 × 2 次重试 × 高清成本 = 高额费用
预览模式：20 页 × 5 面板 × 预览成本 + 确认满意的面板 × 高清成本 = 仅 20-30% 的费用
```

#### 挑战 2：🎭 跨画面/章节的一致性维护

**问题描述**：
- AI 图像生成天然具有随机性，同一提示词多次生成结果可能差异巨大
- 长篇作品中角色可能出现数百次，如何确保"第 1 页的主角"和"第 50 页的主角"是同一个人？
- 场景、服装、道具的细节也需要保持连贯

**解决方案 - 圣经系统**：
- 📖 **角色圣经**：记录角色的详细外貌特征、性格、常见表情、典型动作等，作为生成时的"约束条件"
- 🌍 **场景圣经**：记录场景的布局、光线、氛围、关键物品等，确保场景前后一致
- 🔄 **跨任务复用**：圣经内容可在多个生成任务间持续使用和累积，支持"今天画第 1-5 章，明天画第 6-10 章"
- 🎨 **变体支持**：允许同一角色/场景有不同变体（如"日常服装"/"战斗服装"），系统根据上下文自动选择合适的变体
- 🖼️ **参考图注入**：支持上传用户自己的人设图，作为强约束注入到生成提示中


#### 挑战 3：📝 漫画对白文字生成

**问题描述**：
- 图像生成模型（包括 DALL-E、Midjourney、Imagen 等）在生成**可读的、正确的文字**方面表现极差
- 对白气泡中的文字经常出现乱码、错别字、字体不统一等问题
- 这是当前 AI 绘图领域的**通用性难题**，尚无完美解决方案

**当前状态**：
- ⚠️ **问题仍存在**：本产品目前版本中，对白文字的生成质量不理想

**计划中的解决方案 - 标签-填字混合方法**：
1. 🤖 **AI 确定位置和内容**：由大模型在文本模态下输出对白的**位置坐标**和**文字内容**（JSON 格式）
2. 🎨 **AI 生成无文字底图**：图像生成时要求"不要生成文字"，只画场景和人物
3. ✏️ **传统方法填字**：使用传统图像处理技术（OpenCV/PIL）在指定位置用标准字体渲染文字
4. 🎯 **质量保证**：这样可以确保文字 100% 正确、清晰、可读

**为何重要**：
- 📚 漫画的核心是"图文结合"，没有清晰的对白，作品的可用性大打折扣
- 🎯 这个功能是产品从"技术演示"走向"真正可用"的**关键里程碑**
- 🚀 一旦实现，本产品的实用价值将质的飞跃

---

### 🤖 你计划采纳哪家公司的哪个模型的 AIGC 功能？你对比了哪些，你为什么选择用该 API？

#### 1. 📝 文本分析与分镜生成：Qwen-Plus（阿里云通义千问）

**选择理由**：

**中文理解能力卓越** 🇨🇳
- 以我们的实际使用经验来看，**Qwen、DeepSeek（DS）** 等中国企业训练的大模型在**中文语境理解**、**文学创作**、**情感表达**方面明显优于 GPT-4、Claude 等国外模型
- 尤其在处理中文网文、武侠、仙侠等具有浓厚中国文化特色的内容时，Qwen 的表现尤为出色
- 对于"江湖义气"、"师徒情谊"、"家国情怀"等中文特有的情感表达，Qwen 的理解更加准确和细腻

**成本优势** 💰
- Qwen 提供**足够多的免费 Token 配额**，适合开发和测试阶段
- 即使是付费使用，价格也相对合理（约为 GPT-4 的 1/3-1/5）

**结构化输出** 📊
- 支持 **JSON 严格模式**，确保输出符合预定义的 Schema（角色列表、场景列表、分镜描述等）
- 减少了后处理和错误处理的成本

#### 2. 🎨 图像生成：Gemini Imagen 3（Nano Banana）

**选择理由**：

**美学质量最优** 🎨
- 经过我们的大量测试（对比了 DALL-E 3、Midjourney、Stable Diffusion XL、Imagen 3），**Nano Banana 在漫画风格生成方面表现最好**
- 特别是在**东亚审美**、**二次元风格**、**人物面部细节**方面，Imagen 3 的表现最符合我们的需求
- 个人审美评价："最符合我心目中理想漫画画风"

**参考图一致性** 🖼️
- 支持**多张参考图输入**（Imagen 3 的 `reference_images` 参数），这对于维护角色一致性至关重要
- 可以将"角色圣经"中的参考图注入生成过程，确保输出符合预定义的人设

**生成速度与质量平衡** ⚡
- 相比 Midjourney（需要排队等待），Imagen 3 的 API 调用速度更快（10-30 秒）
- 相比 Stable Diffusion（需要大量 prompt 工程），Imagen 3 更易于控制和调优

**技术栈总结**：
```
小说文本 → Qwen-Plus（分析+分镜） → DynamoDB（圣经存储） → Imagen 3（图像生成） → S3 + CloudFront（图片存储与分发）
```

---

### 🚀 你对这个产品有哪些未来规划中的功能？你为何觉得这些能力是重要的？

#### 1. 🎭 内生支持单一角色/场景多设定并自动选择

**当前问题**：
- 一个角色在不同场景下可能有不同的外观（日常服装 vs. 战斗服装 vs. 正式礼服）
- 目前我们的做法是将"日常版小明"和"战斗版小明"作为**两个独立的角色**来处理
- 这导致了一定的不稳定性：系统可能在战斗场景中错误地使用了"日常版小明"的设定

**计划中的改进**：
- 🎨 **多配置管理**：在圣经中为同一角色维护多个"配置"（Configurations）
- 🤖 **上下文感知**：系统根据当前剧情场景（战斗/日常/正式/睡眠等）**自动选择**合适的配置
- 📊 **权重系统**：为不同配置设置"适用场景标签"和"优先级权重"
- 🔄 **无缝切换**：在同一章节内，角色可以在不同配置间自然切换（例如：从日常服换成战斗服）

**为何重要**：
- ✅ **符合真实需求**：现实中角色的服装、发型、表情会随场景变化，这是基本的写实性要求
- ✅ **减少管理成本**：不必为每个"版本"创建独立的角色，简化圣经管理
- ✅ **提升一致性**：明确的"配置-场景"映射规则，减少错误匹配的概率
- 🎯 **迈向可用性**：这是产品从"能生成"到"生成得好"的关键一步

#### 2. 📚 Bible（圣经）的智能压缩和选择

**当前问题**：
- **Token 长度限制**：Qwen-Plus 的最大输出长度为 **32,768 Token**（约 25,000 汉字）
- **圣经占用空间大**：每个角色的圣经描述约 500-1000 Token，每个场景约 300-500 Token
- **累积效应**：8 个主要角色 + 5 个主要场景 = 约 **8,000-18,000 Token** 被圣经占用
- **篇幅受限**：这导致输入的小说文本 + 输出的分镜描述被压缩，**目前最长只能处理约 6,000 字的章节**

**计划中的改进**：

**方案 A：智能选择（短期）** 🎯
- 📊 **角色出场分析**：预先分析章节内容，识别哪些角色会出场
- 🎯 **按需加载**：只注入本章节会出场的角色/场景的圣经
- 💾 **缓存优化**：为高频出场的角色设置"常驻缓存"

**方案 B：动态压缩（中期）** 🗜️
- 🤖 **AI 摘要**：使用小模型将详细圣经压缩为"核心特征摘要"（从 1000 Token 压缩到 200 Token）
- 🔍 **关键信息提取**：只保留"必须一致"的特征（如发色、瞳色、标志性服饰），省略细节描述
- ⚖️ **质量权衡**：接受一定程度的细节损失，换取更长的篇幅支持

**方案 C：向量检索（长期）** 🔬
- 🗄️ **向量数据库**：将圣经内容转换为向量存储（Pinecone/Milvus）
- 🔍 **语义检索**：根据当前生成的面板描述，检索"最相关"的圣经片段
- 🎯 **动态组装**：只注入与当前面板相关的圣经内容

**为何重要**：
- 📖 **支持长篇创作**：很多网文动辄几十万字，章节分得太碎会影响阅读体验
- ⚡ **提升效率**：减少"拆章-分批-合并"的操作步骤
- 💰 **降低成本**：更长的篇幅意味着更少的 API 调用次数
- 🎯 **行业竞争力**：这是区别于"玩具级产品"的重要指标

#### 3. 🔄 多轮大模型请求 / 分镜与Bible分开请求

**当前问题**：
- **单次请求压力大**：目前在一次 Qwen API 调用中同时完成：小说分析 + 角色提取 + 场景提取 + 分镜生成 + 圣经补充
- **输出长度限制**：所有内容都要在 32K Token 内完成，导致每个部分都被压缩
- **错误传播**：如果某一步出错，整个流程需要重新执行

**计划中的改进**：

**分阶段请求** 🔄
```
第一轮：小说分析 + 角色/场景提取
  ↓ 保存到 DynamoDB
第二轮：基于角色/场景生成详细圣经
  ↓ 保存到 S3
第三轮：基于圣经生成分镜
  ↓ 保存到 DynamoDB
第四轮：基于分镜生成面板详细描述
  ↓ 传递给 Imagen 3
```

**优势**：
- ✅ **突破 Token 限制**：每一轮都可以充分利用 32K 的输出空间
- ✅ **提升质量**：每个阶段可以更加专注和详细
- ✅ **容错能力**：某一轮失败只需重试该轮，不影响其他阶段
- ✅ **并行处理**：圣经生成和分镜生成可以并行执行，提升速度

**挑战**：
- ⚠️ **流程复杂度**：需要精心设计状态机和错误恢复机制
- ⚠️ **成本增加**：多轮请求意味着更多的 API 调用（但单次请求质量提升可能抵消这一成本）

**为何重要**：
- 🎯 **与方案 2 协同**：配合圣经压缩，可以支持更长的小说篇幅
- 📈 **提升整体质量**：每个环节的输出质量提升，最终产品质量会有质的飞跃
- 🏗️ **架构优化**：为未来的功能扩展（如：用户手动介入某一环节）打下基础

---

**总结**：这三个功能都直接关系到产品的**实用性**和**可扩展性**，是我们从"技术验证"走向"生产级产品"的必经之路。我们相信，一旦这些功能实现，本产品将具备真正的商业价值和用户粘性。

## Demo地址：
- https://www.bilibili.com/video/BV1SwskzEESz/
- 我们建议您考虑自己上手体验，而不是只看demo。

## 📋 目录

- [致七牛云评审员](#致七牛云评审员)
- [问题的回答](#问题的回答)
- [Demo地址](#demo地址)
- [环境准备](#-环境准备)
  - [必需工具](#必需工具)
  - [配置文件](#配置文件)
- [首次安装](#-首次安装)
- [AWS 配置](#️-aws-配置)
  - [快速开始](#快速开始)
- [OpenAPI 工作流](#-openapi-工作流)
  - [API 定义文件说明](#api-定义文件说明)
  - [添加新的 API 端点](#添加新的-api-端点)
  - [重要注意事项](#️-重要注意事项)
- [开发流程](#-开发流程)
  - [功能开发流程](#功能开发流程)
  - [本地开发](#本地开发)
- [构建和部署](#️-构建和部署)
  - [前端构建](#前端构建)
  - [后端构建和部署](#后端构建和部署)
- [常用命令](#-常用命令)
  - [OpenAPI 相关](#openapi-相关)
  - [前端开发](#前端开发)
  - [后端开发](#后端开发)
  - [运维脚本](#运维脚本)
- [CI/CD 自动部署](#-cicd-自动部署)
  - [部署架构](#部署架构)
  - [当前部署状态](#当前部署状态)
  - [自动化流程](#自动化流程)
  - [配置步骤](#配置步骤)
  - [验证部署](#验证部署)
  - [监控部署](#监控部署)
  - [Workflow 详情](#workflow-详情)
  - [故障排除](#故障排除)
- [相关文档](#-相关文档)
- [贡献指南](#-贡献指南)

## 🔧 环境准备

### 必需工具
- **Node.js** (推荐 v22.17.1，至少 v22.0.0)
- **pnpm** - 前端包管理器：`npm install -g pnpm`
- **AWS CLI**: https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html
- **AWS SAM CLI**: https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html
- **Docker Desktop** - 后端本地开发需要

### 配置文件
- 配置项目中所有的 `.env.local` 和 `.env` 文件，填入真正的后端参数。
- 由于本项目是Serverless的，您至少需要在AWS上为为本项目准备一个具有Lambda、DynamoDB、SQS、API Gateway、CloudWatch、S3、Cognito的完全访问权限的IAM账户。开通这些服务后，将相关的环境变量写入`.env`文件。
- ⚠️ **重要**: `.env.local` 和 `.env` 仅用于本地测试，**绝对不能提交到代码库**！

## 🚀 首次安装
> 致七牛云评审员：这个项目已经在线上Deploy，我们建议您不要本地Deploy，直接访问 https://ethanlita.github.io/qnyproj 就可以立即开始使用了。
>
> 考虑到相应服务的使用成本，线上使用需要注册账号，请联系这个项目的所有者申请/激活账号。
>
> 您应该能在报名信息里找到这个项目的所有者。
>
> 如果您决心要自行部署这个项目，那么请参考以下内容。
```bash
# 1. 克隆项目
git clone <repository-url>
cd qnyproj

# 2. 安装根目录依赖（用于 OpenAPI 生成）
npm install

# 3. 安装前端依赖
cd frontend
pnpm install
cd ..

# 4. 生成前端 API 客户端（基于 OpenAPI 规范）
npm run generate:frontend-api

# 5. 启动开发服务器
cd frontend && pnpm dev
```

启动后访问 http://localhost:5173，你会看到：
- **登录页面** - 您需要登录，这个页面是Cognito托管的。
- **主界面** - 登录后您就能看到工作台了。

## ☁️ AWS 配置

在部署到 AWS 之前，需要完成以下配置步骤：

### 快速开始

1. **配置 AWS CLI**
   ```bash
   aws configure
   # 输入 Access Key ID, Secret Access Key, Region
   ```

2. **创建 Cognito 用户池** (可选，用于认证端点)
   - 访问 AWS Console → Cognito
   - 创建用户池并记录 User Pool ID
   - 更新到 `backend/samconfig.toml`

3. **首次手动部署** (推荐)(sam cli会根据template自动在AWS上创建所需要的资源)
   ```bash
   npm run deploy:backend
   ```


## 📝 OpenAPI 工作流

### API 定义文件说明

| 文件 | 用途 | 是否手动编辑 |
|------|------|------------|
| `openapi.template.yaml` | **主文件**：包含完整 OpenAPI 规范 + AWS 扩展 | ✅ **是** |
| `openapi.yaml` | 自动生成的纯 OpenAPI 文件（供前端使用） | ❌ **否** |
| `frontend/src/api/generated/` | 自动生成的 TypeScript API 客户端 | ❌ **否** |

### 添加新的 API 端点

**步骤 1**: 编辑 `openapi.template.yaml`

```yaml
paths:
  /users:  # 新端点
    get:
      summary: Get all users
      security:
        - CognitoAuthorizer: []
      responses:
        '200':
          description: List of users
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: '#/components/schemas/User'
      x-amazon-apigateway-integration:
        type: aws_proxy
        httpMethod: POST
        uri:
          Fn::Sub: "arn:aws:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${GetUsersFunction.Arn}/invocations"

components:
  schemas:
    User:  # 新模型
      type: object
      properties:
        id:
          type: string
        name:
          type: string
```

**步骤 2**: 生成前端 API 客户端

```bash
npm run generate:frontend-api
```

**步骤 3**: 在前端代码中使用

```typescript
import { DefaultService } from './api/generated';

// 类型安全的 API 调用
const users = await DefaultService.getUsers();
```

**步骤 4**: 实现后端 Lambda 函数并部署

```bash
npm run deploy:backend
```

### ⚠️ 重要注意事项

1. **唯一事实来源**: 只编辑 `openapi.template.yaml`
2. **自动生成**: `openapi.yaml` 和 `frontend/src/api/generated/` 都是自动生成的，不要手动编辑
3. **版本控制**: 这些自动生成的文件已添加到 `.gitignore`，不会提交到 Git
4. **每次修改 API 后**: 必须运行 `npm run generate:frontend-api` 重新生成客户端代码
5. **跨平台兼容**: 所有脚本在 Windows (PowerShell/CMD) 和 Unix-like 系统 (Bash/Zsh) 中都能正常工作

## 🔄 开发流程

### 功能开发流程
1. 创建新分支: `git checkout -b feature/your-feature-name`
2. 如果涉及 API 修改:
   - 编辑 `openapi.template.yaml`
   - 运行 `npm run generate:frontend-api`
3. 开发功能
4. 本地测试
5. 提交代码并创建 Pull Request
6. 代码评审
7. 合并后自动部署

### 本地开发

```bash
# 前端开发
npm run dev:frontend
# 或直接在 frontend 目录：pnpm dev

# 后端本地测试（需要 Docker）
cd backend
sam local start-api
```

## 🏗️ 构建和部署

### 前端构建
```bash
npm run build:frontend
# 或直接在 frontend 目录：pnpm build
```

### 后端构建和部署
```bash
# 本地构建
cd backend
sam build --use-container

# 部署到 AWS（自动生成最新的 openapi.yaml）
npm run deploy:backend
```

## 📋 常用命令

### OpenAPI 相关
```bash
# 从 template 生成纯净的 openapi.yaml
npm run generate:openapi

# 生成前端 TypeScript API 客户端
npm run generate:frontend-api
```

### 前端开发
```bash
# 启动开发服务器
npm run dev:frontend

# 构建生产版本（会自动生成最新的 API 客户端）
npm run build:frontend
```

### 后端开发
```bash
# 本地启动 API（需要 Docker）
cd backend
sam local start-api

# 部署到 AWS
npm run deploy:backend
```

### 运维脚本
```bash
# 清空堆栈内所有 SQS 队列并标记未完成 Job 为 failed
npm run purge:sqs

# 自定义参数示例
# node scripts/clear-sqs.js --stack=qnyproj-api --types=analyze,reference_image --skip-purge
```
> `purge:sqs` 会自动从 CloudFormation 堆栈（默认 `qnyproj-api`）读取所有 SQS 队列和 DynamoDB 表，先清空队列再把状态为 `queued/pending/running` 的 Job 写成 `failed`。若只想标记 Job 而暂时保留队列中的消息，可附加 `--skip-purge`。

## 🤖 CI/CD 自动部署

本项目使用 GitHub Actions 实现完全自动化的 CI/CD 流程。我们强烈建议您也使用 CI/CD 工作流。

### 部署架构

```
Push to main → GitHub Actions
                ├─→ Backend: AWS SAM Deploy (Lambda + API Gateway)
                └─→ Frontend: GitHub Pages Deploy (gh-pages branch)
```

### 当前部署状态

**后端 (AWS)**:
- 📍 **API URL**: `https://ds0yqv9fn816.execute-api.us-east-1.amazonaws.com/dev`
- 🌐 **端点类型**: Edge-Optimized (CloudFront CDN 全球加速)
- 📦 **Lambda**: `qnyproj-api-HelloWorldFunction-7vF4AmhBaeOA`
- 🏷️ **Stack**: `qnyproj-api` (us-east-1)

**可用 API 端点**:
```bash
# Edge Probe - 返回请求头信息（包含 CloudFront headers）
GET https://ds0yqv9fn816.execute-api.us-east-1.amazonaws.com/dev/edge-probe

# Items - 示例数据列表
GET https://ds0yqv9fn816.execute-api.us-east-1.amazonaws.com/dev/items
```

**前端 (GitHub Pages)**:
- 🔗 **URL**: `https://ethanlita.github.io/qnyproj/` (即将部署)
- 📂 **部署方式**: Deploy from Branch (`gh-pages`)
- ⚡ **构建工具**: Vite

### 自动化流程

**当你 Push 到 main 分支时**:
1. ✅ **Backend Deploy** - SAM build & deploy 到 AWS
2. ✅ **Frontend Build** - pnpm build 生产版本
3. ✅ **GitHub Pages Deploy** - 推送到 gh-pages 分支，自动发布

**当你创建 Pull Request 时**:
- 🧪 TypeScript 类型检查
- 🔍 ESLint 代码检查
- 🏗️ 前端构建测试
- 🧪 后端单元测试

### 配置步骤

#### 1. 配置 GitHub Secrets

在 **Settings → Secrets and variables → Actions** 添加：

| Secret 名称 | 说明 | 获取方式 |
|------------|------|---------|
| `AWS_ACCESS_KEY_ID` | AWS 访问密钥 ID | IAM 用户凭证 |
| `AWS_SECRET_ACCESS_KEY` | AWS 秘密访问密钥 | IAM 用户凭证 |
| `AWS_REGION` | AWS 区域 | `us-east-1` |

💡 **提示**: 详细的 IAM 用户创建步骤请查看 [AWS_SETUP.md](./AWS_SETUP.md)

#### 2. 启用 GitHub Pages

**Settings → Pages**:
- **Source**: Deploy from a branch
- **Branch**: `gh-pages` / `root`
- **保存后等待 GitHub Actions 首次部署**

#### 3. 验证部署

**检查 Backend**:
```bash
# 测试 Edge Probe 端点
curl https://ds0yqv9fn816.execute-api.us-east-1.amazonaws.com/dev/edge-probe

# 应该返回包含 CloudFront headers 的 JSON
```

**检查 Frontend**:
- 访问 `https://<username>.github.io/<repo-name>/`
- 应该看到完整的应用界面（包括 Swagger UI）

### 监控部署

**GitHub Actions**:
- 📊 仓库 → **Actions** 标签
- 查看每次部署的详细日志

**AWS 监控**:
```bash
# 查看 CloudFormation Stack 状态
aws cloudformation describe-stacks --stack-name qnyproj-api

# 查看 Lambda 日志
aws logs tail /aws/lambda/qnyproj-api-HelloWorldFunction-7vF4AmhBaeOA --since 10m
```

### Workflow 详情

文件: `.github/workflows/deploy.yml`

**3 个主要 Jobs**:

1. **deploy-backend** (Push to main)
   - Setup Node.js & Python
   - Install AWS SAM CLI
   - Build with Docker container
   - Deploy to AWS CloudFormation

2. **deploy-frontend** (Push to main)
   - Setup Node.js & pnpm
   - Generate API client from OpenAPI
   - Build production bundle
   - Push to `gh-pages` branch

3. **test** (Pull Requests)
   - TypeScript check (`tsc --noEmit`)
   - Lint (`pnpm lint`)
   - Build test
   - Backend unit tests

### 故障排除

**Backend 部署失败**:
```bash
# 检查 SAM 配置
cat backend/samconfig.toml

# 手动部署测试
cd backend
sam build --use-container
sam deploy --debug
```

**Frontend 部署失败**:
- 检查 `pnpm-lock.yaml` 是否提交
- 确认 `npm run build:frontend` 本地可以成功
- 查看 Actions 日志中的具体错误

**GitHub Pages 404**:
- 确认 `gh-pages` 分支已创建且包含 `index.html`
- 检查 Settings → Pages 配置是否正确
- 等待几分钟让 GitHub 完成部署

## 📚 相关文档

- [OpenAPI Specification](https://swagger.io/specification/)
- [AWS API Gateway OpenAPI Extensions](https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-swagger-extensions.html)
- [AWS SAM Documentation](https://docs.aws.amazon.com/serverless-application-model/)
- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [GitHub Pages Documentation](https://docs.github.com/en/pages)

## 🤝 贡献指南

1. Fork 本项目
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启 Pull Request
