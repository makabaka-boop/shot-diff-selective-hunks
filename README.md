# 纪录片重剪 · 镜头序列变更轨迹

对重剪前后两组整数镜头编号求**最短插入/删除对齐**，输出可逐项复核的变更轨迹。
前端 React（Vite + TypeScript），后端 FastAPI，**不使用数据库**，由 Docker Compose 启动。

## 目录结构

```
api/                FastAPI + 有界 Myers（无第三方差分库）
  app/myers.py      算法：d 递增、k 递增扩展最远 x；同 x 选删除前驱；同规则回溯
  app/main.py       POST /diff（普通 JSON 整数数组）、422 错误码
  tests/            pytest：最短性（LCS 对拍）、删除优先裁决、422 裁决
  verify/acceptance.py  compose 的 verify 一次性验收服务入口
web/                React 前端
  src/components/ResultView.tsx        距离 + 每项零基源/目标下标
  src/components/NumberListEditor.tsx  可增删的整数编号输入
  src/components/ResultView.test.tsx   Vitest 结果视图测试
  e2e/spec.spec.ts    Playwright：真实输入贯通与失败提示
docker-compose.yml  api / web / verify 三服务
```

## 启动

```bash
cp .env.example .env        # 可选：覆盖宿主端口
docker compose up --build   # web 在 WEB_PORT(默认 8080)，api 在 API_PORT(默认 8000)
```

浏览器打开 `http://localhost:${WEB_PORT:-8080}`。页面只与同源 `/api` 通信，
nginx 将 `/api/` 反代到 `api:8000`。

一次性验收（退出码 0 表示通过，容器随即停止）：

```bash
docker compose run --rm verify
```

## 接口

`POST /diff`，请求体为普通 JSON：

```json
{ "source": [1, 2, 3], "target": [1, 4, 3] }
```

响应：

```json
{
  "distance": 2,
  "length_source": 3,
  "length_target": 3,
  "alignment": [
    {"type": "keep",   "source": 0,    "target": 0,    "value": 1},
    {"type": "insert", "source": null, "target": 1,    "value": 4},
    {"type": "delete", "source": 1,    "target": null, "value": 2},
    {"type": "keep",   "source": 2,    "target": 2,    "value": 3}
  ]
}
```

- `type`：`keep`（沿对角线保留）、`delete`（删除源项）、`insert`（插入目标项）。
- 代价：插入、删除各 1；相同编号自动沿对角线白走（snake）。
- 下标均为**零基**；不适用的一侧为 `null`。

错误一律 HTTP 422：

| code            | 触发条件                                                     |
| --------------- | ------------------------------------------------------------ |
| `INVALID_INPUT` | 非整数、越界（<0 或 >2147483647）、数组超过 20000 项、结构错误 |
| `DIFF_LIMIT`    | 只搜索至编辑距离 d=800 仍未到达终点                          |

## 算法约束（自行实现，无逐格矩阵）

`api/app/myers.py` 的有界 Myers：

1. `V[k]` 表示当前距离层、对角线 `k = x-y` 上可达的最远 x；按 **d=0…800** 递增，
   每层 **k 从 -d 到 d 递增**扩展。
2. 到达同一条对角线时：插入来自 `V[k+1]`（向下），删除来自 `V[k-1]+1`（向右）；
   **两者 x 相同（`V[k-1]+1 >= V[k+1]`）时选删除前驱**；边界 k=±d 只有唯一前驱。
3. 每次扩展沿对角线白走所有相等编号；到达 `(N,M)` 立即停止。
4. 用每层 V 的**逐层快照**回溯（约 O(d²) 内存而非 N×M 矩阵），回溯使用同一条
   删除优先裁决，产出完整 `keep/insert/delete` 对齐。
5. 服务端对结果做重放自检：保留与插入按序产出、删除不产出，必须**精确等于目标序列**。

因此两组各 20000 项、距离很小的长片改动也只需极小内存；最坏（距离约 800）在
普通机器上也是亚秒级返回或 `DIFF_LIMIT`。

## 本地开发与测试

```bash
# 后端
cd api && pip install -r requirements-dev.txt
pytest

# 前端（另开终端，Vite 代理 /api -> localhost:8000）
cd web && npm install
npm test                 # Vitest
npx playwright test      # 需 uvicorn 与 vite dev 同时在跑（CI 下自动拉起）
```
