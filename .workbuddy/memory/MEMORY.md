# MEMORY.md

_长期有效的项目背景与约定。更新时请就地改写，并在条目后标注更新日期。_

## 项目：DHJ_cost_calculate（咖啡豆成本及定价核算）

用户在做一个精品咖啡品牌，自己做了一个 Excel 成本核算表：`/Users/ywit/Downloads/成本及定价核算.xlsx`。
主要工作是围绕这张表做分析、修 bug、补缺口、做盈利建模。

### 工作簿结构（6 个 sheet）

- **`produce cost`**：单品成本清单（生豆、包装、水电、物流）。生豆单价：拼配 120/kg、SOE 150/kg；快递费 15 元/单
- **`operation cost`**：公司/年度运营成本。列 F 是"年度摊销系数"（0.25=4 年、0.2=5 年、1=完全计入当年）
- **`others`**：全局比例。生豆损耗 20%、平台抽成 2%、包装损耗 5%、营销费用 20%（**按利润的 20%，口径不常规**）
- **`capacity`**：3 个产能情景。Low 480 kg/年、Mid 1320、High 1800（每周工时 × 每小时产出 × 工作周数）
- **`cost&price`**：单 SKU 生产成本与 40%/50%/60% 三档毛利率建议售价。**⚠️ 售价没包含物流 I**
- **`profit`**：年度盈亏情景。**3 产能 × 3 利润率 = 9 组合**，每组合 6 个 SKU（110g/225g/礼盒 × 拼配/SOE），拼配:SOE=1:1，110g:225g:礼盒=0.5:0.3:0.2

### 关键公式

- `cost&price.F = E/0.8`（生豆损耗 20% 反推用量）
- `cost&price.J = G + H`（不含物流 I）
- `profit.J = F×(1+包装损耗) + H`（**漏了 G 物流**）
- `profit.H = H$17 * (E/E$17)`（运营成本按销量占比分摊）
- `profit.M = L × 20%`（营销费用按利润计）

### 已识别的 bug（待用户决定是否修）

1. 🔴 `profit.J` 漏算物流成本 G → 所有场景利润系统性高估
2. 🔴 `cost&price.J` 不含物流 I → 售价未覆盖快递费，真实毛利率低于标称
3. 🟡 `cost&price.H` 把电费 D$13 放进了包装项（数值对但易漏）
4. 🔴 Scenario 2 Mid 的 `H` 分摊分母还在用 E$17（Scenario 1 的总销量），没换成 Mid 自己的。Scenario 3 High 已改成 E168
5. 🟡 营销费按利润计，亏损时会"退钱"，口径不合理
6. 🟡 平台抽成 2% 偏低（真实 5-8%）
7. 🟡 商标注册按 4 年摊销不合理（商标 10 年有效期，应为 0.1）

### 用户偏好 / 工作习惯

- 用户偏好详尽的技术解释与具体排查步骤；Bug 反馈习惯用编号列表
- 推进复杂任务时喜欢"先分析不写代码、确认无误后再动手"的节奏
- 对长回复可能触发客户端 10004 错误（消息流中断），建议分段发送

### 当前进度

- 2026-04-20：完成表格内容与计算逻辑的梳理，识别出 7 个 bug/优化点 + 一批成本/收入缺口
- 2026-04-20：用户决策完毕，要求做成网站。**已交付 v0.1**（仓库根是 Vite+React+TS+Tailwind 项目）

## DHJ_Pricing 网站项目（v0.1 已完成）

**部署目标**：`https://llawliet1900.github.io/DHJ_Pricing/`（仓库 `github.com/Llawliet1900/DHJ_Pricing`）

**本地开发**：
- `npm install && npm run dev` → http://localhost:5173/DHJ_Pricing/
- `npm run build` 产出到 `dist/`
- `npm run verify` 跑计算逻辑单元测试（20 条断言）

**核心设计**：
- 6 个 Tab：成本项 / 比例参数 / 产能 / 豆子配方 / 盈利总览 / 计算校验
- 数据存浏览器 localStorage（key=`dhj-cost-calc`），支持 JSON 导入导出
- 前端密码门（sha256），默认密码 `dhj123`，部署时通过 `VITE_PASSWORD_HASH` secret 替换
- GitHub Actions 自动部署（push main 触发）

**最终口径（与原 Excel 差异）**：
- 生豆用量：`熟豆g / (1-lossSort 5%) / (1-lossRoast 15%)`，取代原 `÷0.8`
- 售价：`生产成本 / (1 − margin − platformFee − marketing/GMV)`，原公式 `C/(1-margin)` 忽略了平台和营销
- 运营分摊按规格 kg 占比（正确的总销量分母）
- 营销按 GMV×20%（原来是利润×20%，亏损时会退钱）
- 平台抽成：多平台加权（默认微信小程序 100%×1%）
- 包装件：豆袋/贴纸/小卡/角贴/蜂窝纸/快递盒/胶带（7 项，取代原腰封+牛皮绳+感谢卡）
- 4 款豆子预置：九尾(拼配) / 朏胐(拼配) / 精卫(SOE) / 鸾鸟(SOE)
- 目前**不含礼盒**（按用户要求）

**v0.2 迭代（2026-04-20 当日）**：
- 生豆单价**每款豆子独立**（`Bean.greenPricePerKg`），Ratios 里两个全局值只作为"新建豆款"时的默认值
- SKU 支持**"目标毛利→售价"和"手动售价→反推毛利"两种定价模式**，逐行切换
- 规格 SKU 可任意增删复制，支持自定义 `label` 和任意克重（不限 110g/225g）
- localStorage v1→v2 自动迁移（`migrate` in persist）
- 单元测试扩充到 37 条断言，全部通过
- Git 远程已切 SSH：`git@github.com:Llawliet1900/DHJ_Pricing.git`；本机已有 `~/.ssh/id_rsa`（RSA key，2025-08-15 生成）
- GH Pages Settings → Source 选 "GitHub Actions"（**不是** Deploy from a branch），Actions workflow 已跑通

**v0.3 迭代（2026-04-21）**：
- `ProfitInputs.freeShipping?: boolean`，默认 true（兼容 v0.2 口径）。`packCost(state, bean, variant, includeLogistics=true)` 多加一个参数；`computeProfit` 内部：售价按"含物流成本"推（切换不动售价），不包邮时成本里扣物流
- ProfitPage 顶部加包邮/不包邮 radio
- `addBean` 改 unshift，新豆款插最上方
- store 加 `moveCostItem` / `moveBean(id, dir=-1|1)` + `moveArr` helper；CostItemsPage 每行、BeansPage 卡片头都加了 ↑↓
- 规格 SKU 表列宽加大：规格名 w-28→w-32、熟豆 w-20→w-24、本款占比 w-24→w-28
- AuditPage 第 6 段下面加当前情景 SKU 年度盈亏快照表；第 7 段下面加 Break-even 数值表（固定成本 / 每 kg 贡献 / 保本年月销量 / 月 GMV）
- 37/37 测试仍全绿；build 产物 255 kB / 77 kB gzip

**v0.4 迭代（2026-05-26）— 实销分析页**：
- 新 Tab「6. 实销分析」（盈利总览之后），整体放在 `src/pages/SalesPage.tsx`
- 数据模型：`SalesOrder`（订单 SKU 行）、`SpecMapping`（规格ID→bean+variant）、`SalesState`（orders/mappings/platformConfig/analysis/importedFiles/salesStartDate）；store schema v2→v3 自动迁移
- 订单 Excel 解析：`src/salesImport.ts`，依赖 `@e965/xlsx`（不用 `xlsx` 主包，npm 上版本带 high CVE）
  - `parseOrderXlsx` 容错列名，支持 Excel 序号/字符串/Date 三种支付时间
  - `extractRangeFromFilename` 从 `订单明细数据(YYYY-MM-DD~YYYY-MM-DD).xlsx` 抓时间区间
  - `mergeOrders` 按 `orderId__specId` 去重，新覆盖旧 → **每月增量导入不丢历史数据**
- 计算引擎（engine.ts）新增：`filterOrdersByWindow` / `spanDays` / `aggregateSales` / `computeSalesSummary` / `computeRunRate` / `autoMatchSpec`
- 关键口径：
  - GMV → 净收入（扣平台佣金，默认小红书 1%）→ 毛利（再扣变动成本+营销）→ 净利
  - 累计运营摊销并列两口径：按天数（spanDays/365）+ 按销量（kg/scenarioKg）
  - 跑速年化：窗口日均×365，扣**全年**运营成本
- UI 五大模块：导入区（拖拽+多文件） / 平台配置 / 规格映射区（自动匹配+手动指认） / 4 张 KPI / 累计-跑速对照卡 / SKU 明细表 / 单袋实收价 SVG 折线图
- 测试 62/62 全绿（37 + 25 sales 新增）；build 648 kB / 209 kB gzip（xlsx 占 ~400 kB；可后续 dynamic import 优化首屏）
- 用户实测数据（2026-04-25~05-24 月度）：26 行 100% 解析；月 GMV ≈ ¥2,793.80；7 个规格 ID 全部自动映射到 4 款豆子 × 110g/225g

**回复节流约定（2026-04-21 血的教训）**：
- 单次消息改太多文件 / 读太多长文件会触发 10004（消息流中断）或 14003（模型资源超限）
- 下次再做批量改动时，默认每条回复只动一个文件/一个点，不重复读长文件

