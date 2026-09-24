import { expect as pwExpect, test, type Page, type Locator } from "@playwright/test";

const expect = pwExpect;

function section(page: Page, testId: string): Locator {
  return page.getByTestId(testId);
}

/** 通过真实 UI（增加按钮 + 输入框）批量填入整数镜头编号。 */
async function fillList(page: Page, testId: string, values: (string | number)[]) {
  const sec = await section(page, testId);
  const addBtn = sec.getByRole("button", { name: "＋ 增加一项" });
  const inputs = sec.locator("input");
  while ((await inputs.count()) < values.length) {
    await addBtn.click();
  }
  for (let i = 0; i < values.length; i += 1) {
    await inputs.nth(i).fill(String(values[i]));
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test.describe("镜头序列输入", () => {
  test("可以增加与删除编号输入行", async ({ page }) => {
    const src = page.getByTestId("source-editor");
    const addBtn = src.getByRole("button", { name: "＋ 增加一项" });
    expect(await src.locator("input")).toHaveCount(1);

    await addBtn.click();
    await addBtn.click();
    expect(await src.locator("input")).toHaveCount(3);

    await src.getByRole("button", { name: "删除第 1 项" }).click();
    expect(await src.locator("input")).toHaveCount(2);

    // 回车键在行尾快速追加并聚焦新行。
    await src.locator("input").last().fill("55");
    await src.locator("input").last().press("Enter");
    expect(await src.locator("input")).toHaveCount(3);
    await expect(src.locator("input").last()).toBeFocused();
  });

  test("空数组也是合法输入，距离为 0", async ({ page }) => {
    await page.getByTestId("compare").click();
    await expect(page.getByTestId("distance")).toContainText("0");
    expect(await page.getByTestId("alignment-row").count()).toBe(0);
  });
});

test.describe("真实联调的变更轨迹", () => {
  test("输入两组编号，得到距离、零基下标，且轨迹重放精确等于目标", async ({ page }) => {
    await fillList(page, "source-editor", [1, 2, 3]);
    await fillList(page, "target-editor", [1, 4, 3]);
    await page.getByTestId("compare").click();

    await expect(page.getByTestId("distance")).toContainText("2");
    await expect(page.getByTestId("summary")).toContainText("源 3 项 → 目标 3 项");

    const rows = page.getByTestId("alignment-row");
    await expect(rows).toHaveCount(4);

    const table = await rows.evaluateAll((trs) =>
      trs.map((tr) => ({
        type: tr.querySelector('[data-testid="row-type"]')?.textContent,
        value: tr.querySelector('[data-testid="row-value"]')?.textContent,
        source: tr.querySelector('[data-testid="row-source"]')?.textContent,
        target: tr.querySelector('[data-testid="row-target"]')?.textContent,
      }))
    );
    expect(table).toEqual([
      { type: "保留", value: "1", source: "0", target: "0" },
      { type: "插入（目标）", value: "4", source: "—", target: "1" },
      { type: "删除（源）", value: "2", source: "1", target: "—" },
      { type: "保留", value: "3", source: "2", target: "2" },
    ]);

    // 最终轨迹重放：保留与插入顺序产出，删除不产出，必须精确得到目标序列。
    const replayed = table
      .filter((r) => r.type !== "删除（源）")
      .map((r) => Number(r.value));
    expect(replayed).toEqual([1, 4, 3]);
  });

  test("只删不改：纯删除轨迹距离等于删除条数", async ({ page }) => {
    await fillList(page, "source-editor", [10, 20, 30, 40]);
    await fillList(page, "target-editor", [10, 40]);
    await page.getByTestId("compare").click();
    await expect(page.getByTestId("distance")).toContainText("2");
    expect(await page.getByTestId("alignment-row").filter({ hasText: "删除（源）" }).count()).toBe(2);
  });
});

test.describe("失败提示来自真实后端", () => {
  test("非整数与越界值显示 INVALID_INPUT 而不是固定文案", async ({ page }) => {
    // 小数：前端原样作为字符串发送，由 FastAPI 严格整数校验裁决。
    await fillList(page, "source-editor", ["3.5", 1]);
    await fillList(page, "target-editor", [1]);
    await page.getByTestId("compare").click();

    const banner = page.getByTestId("error-banner");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("INVALID_INPUT");
    await expect(page.getByTestId("result-view")).toHaveCount(0);

    // 修正为合法输入后再次提交，失败提示消失、结果出现（接口确为实时调用）。
    const src = page.getByTestId("source-editor");
    await src.locator("input").first().fill("3");
    await page.getByTestId("compare").click();
    await expect(page.getByTestId("error-banner")).toHaveCount(0);
    // 源 [3,1] -> 目标 [1]：删除一个源项，距离为 1。
    await expect(page.getByTestId("distance")).toContainText("1");
  });

  test("超过 2147483647 的编号返回 422 并展示 INVALID_INPUT", async ({ page }) => {
    await fillList(page, "source-editor", [2147483648]);
    await fillList(page, "target-editor", []);
    await page.getByTestId("compare").click();
    await expect(page.getByTestId("error-banner")).toContainText("INVALID_INPUT");
  });

  test("编辑距离超过 800 时显示 DIFF_LIMIT", async ({ page }) => {
    // 401 个 1 对 401 个 2：完全不相交，距离 802 > 800，必须停止搜索。
    test.slow();
    await fillList(
      page,
      "source-editor",
      Array.from({ length: 401 }, () => 1)
    );
    await fillList(
      page,
      "target-editor",
      Array.from({ length: 401 }, () => 2)
    );
    await page.getByTestId("compare").click();
    const banner = page.getByTestId("error-banner");
    await expect(banner).toBeVisible({ timeout: 30_000 });
    await expect(banner).toContainText("DIFF_LIMIT");
  });
});
