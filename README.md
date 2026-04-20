# ☕ DHJ 咖啡成本 & 定价核算

一个纯前端的咖啡品牌「成本核算 + 定价建议 + 盈利预测」工具。所有数据保存在你自己的浏览器里，不联网、不回传。

在线访问（部署后）：`https://llawliet1900.github.io/DHJ_Pricing/`

---

## 功能

- **1. 成本项管理** — 所有成本（生豆、包装、水电、物流、一次性投入、固定资产、年度运营等）在一张表里维护；一次性成本按摊销年数自动折算到年
- **2. 比例参数** — 挑豆损耗、烘焙失水、包装损耗、退货率、营销占 GMV 比例；平台抽成按平台拆分并加权
- **3. 产能情景** — Low / Mid / High 三套产能假设，公式按 `工时 × kg/小时 × 年周数` 拆开
- **4. 豆子配方** — 每款豆子独立设置生豆来源、包装组合、规格（110g / 225g 等熟豆克重）和目标毛利率；实时看到每包成本明细和建议售价
- **5. 盈利总览** — 选一个产能情景 + 调整各款豆子占比 → 年度 GMV、生产成本、运营分摊、平台、营销、退货、**净利润**、**Break-even 保本点**、**敏感性分析**
- **6. 计算校验** — 展示所有公式和中间变量，方便手工核对

附加：
- 数据导入 / 导出 JSON，用于备份与迁移
- 前端密码门保护（见下文）

---

## 核心计算公式

```
生豆用量 (g)   = 熟豆克重 / (1 − 挑豆损耗) / (1 − 烘焙失水)
生豆成本       = 生豆用量 / 1000 × 生豆单价
包装成本       = Σ(包装件单价 × 用量)
生产成本(含损) = (生豆 + 包装) × (1 + 包装损耗) + 物流
年度总运营     = Σ(一次性单价 / 摊销年数) + Σ(年度金额)
建议售价       = 生产成本 / (1 − 目标毛利 − 平台抽成 − 营销/GMV)
              （保证：扣除平台抽成与营销后，毛利率正好 = 目标毛利）

每 variant 年 kg = 年产能 × 豆款占比 × variant占比
年包数          = 年 kg × 1000 / 克重
年 GMV         = 年包数 × 售价
运营分摊        = 年度总运营 × 本 variant 年 kg / 总年 kg
净利润          = GMV − 年生产成本 − 运营分摊 − 平台抽成 − 营销 − 退货

Break-even:
每 kg 贡献     = 售价 × (1 − 平台抽成 − 营销/GMV − 退货率) × (1000/克重) − 生产成本 × (1000/克重)
保本年销量     = 年度总运营 / 加权每 kg 贡献
```

单元测试验证见 `src/verify.ts`（20 条断言全部通过）。

---

## 本地运行

```bash
npm install
npm run dev       # 开发模式，http://localhost:5173
npm run build     # 生产构建，输出到 dist/
npm run preview   # 本地预览构建产物
npx tsx src/verify.ts  # 跑一遍计算逻辑单元测试
```

Node 版本 >= 20。

---

## 部署到 GitHub Pages

项目已附带 GitHub Actions workflow（`.github/workflows/deploy.yml`），push 到 `main` 分支会自动构建并部署。

### 初次部署步骤

1. 在 GitHub 仓库设置里：**Settings → Pages → Build and deployment → Source** 选 **GitHub Actions**
2. （可选但强烈建议）设置自定义密码：
   - 本地执行 `echo -n 'your-new-password' | shasum -a 256`，拿到 64 位十六进制 hash
   - 在 GitHub 仓库 **Settings → Secrets and variables → Actions → New repository secret** 里新建
   - Name: `VITE_PASSWORD_HASH`
   - Secret: 上面生成的 hash
3. `git push origin main`，等 Actions 跑完即可访问

### 修改密码

重新生成 hash，更新仓库 Secret，然后 push 一个空提交即可触发重新构建：

```bash
git commit --allow-empty -m "rotate password"
git push
```

---

## 密码保护说明

- 使用「前端密码门」：进入时输入密码，浏览器侧 SHA-256 比对
- **默认密码 `dhj123`**（哈希 `6a37392241fa629e32bc7e1b711623d609a93dc9aa3d9b273b480b85ccae991c`）
- 首次部署后请立刻按上面的步骤修改为自己的密码
- 安全性：这是"展示层门禁"，可以挡住偶然访问，但无法防专业技术人员。成本核算表属于商业敏感数据；如果你要求更强防护，建议：
  - 把仓库改为 private（需要 GitHub Pro 账号才能 private + Pages）
  - 或者切到 Vercel / Cloudflare Pages 使用它们的原生密码保护

---

## 数据备份

- 所有数据保存在浏览器 `localStorage` (`dhj-cost-calc` 键)
- 在页面右上角可「导出 JSON」「导入 JSON」
- 清浏览器缓存前记得先导出备份
- 换设备也是用 JSON 文件迁移

---

## 技术栈

- Vite + React + TypeScript
- Tailwind CSS v3
- Zustand (状态管理 + localStorage 持久化)
- 零后端、零外部依赖的静态站点

---

## License

Private use. 
