import { expect as pwExpect, test, type Page } from "@playwright/test";

const expect = pwExpect;

async function fillList(
  page: Page,
  testId: string,
  values: (string | number)[]
) {
  const sec = page.getByTestId(testId);
  const addBtn = sec.getByRole("button", { name: "＋ 增加一项" });
  const inputs = sec.locator("input");
  while ((await inputs.count()) < values.length) {
    // eslint-disable-next-line no-await-in-loop
    await addBtn.click();
  }
  for (let i = 0; i < values.length; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await inputs.nth(i).fill(String(values[i]));
  }
}

async function compute(page: Page) {
  await page.getByTestId("compare").click();
  await expect(page.getByTestId("block-review")).toBeVisible();
}

async function hybridText(page: Page) {
  return (await page.getByTestId("hybrid-sequence").textContent()) ?? "";
}

async function waitRemaining(page: Page, distance: string) {
  await expect(page.getByTestId("remaining-distance")).toContainText(distance);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test.describe("逐块采纳：纯插入 / 纯删除 / 相邻改写 / 重复镜头", () => {
  test("纯插入：不选=source，采纳后=target，剩余距离归零", async ({ page }) => {
    await fillList(page, "source-editor", [1, 4]);
    await fillList(page, "target-editor", [1, 2, 3, 4]);
    await compute(page);

    await expect(page.getByTestId("block-item")).toHaveCount(1);
    expect(await hybridText(page)).toBe("1 4"); // 不选精确等于 source

    await page.getByTestId("block-checkbox").check();
    await expect.poll(() => hybridText(page)).toBe("1 2 3 4"); // 全选=target
    await waitRemaining(page, "0");

    // 取消采纳回到 source，剩余轨迹重新出现（不覆盖原始距离 2）。
    await page.getByTestId("block-checkbox").uncheck();
    await expect.poll(() => hybridText(page)).toBe("1 4");
    await waitRemaining(page, "2");
    await expect(page.getByTestId("distance")).toContainText("2");
  });

  test("纯删除：采纳块即移除镜头，剩余距离随选择变化", async ({ page }) => {
    await fillList(page, "source-editor", [10, 20, 30, 40]);
    await fillList(page, "target-editor", [10, 40]);
    await compute(page);

    expect(await hybridText(page)).toBe("10 20 30 40");
    await page.getByTestId("block-checkbox").check();
    await expect.poll(() => hybridText(page)).toBe("10 40");
    await waitRemaining(page, "0");
  });

  test("相邻改写：两块独立采纳、无下标漂移，全部采纳才等于 target", async ({
    page,
  }) => {
    // 块0: 2->9（边界 1）；中间 keep 3；块1: 4->8（边界 3）。
    await fillList(page, "source-editor", [1, 2, 3, 4, 5]);
    await fillList(page, "target-editor", [1, 9, 3, 8, 5]);
    await compute(page);

    await expect(page.getByTestId("block-item")).toHaveCount(2);
    expect(await hybridText(page)).toBe("1 2 3 4 5"); // 不选 = source

    const boxes = page.getByTestId("block-checkbox");
    await boxes.nth(0).check();
    await expect.poll(() => hybridText(page)).toBe("1 9 3 4 5");
    await boxes.nth(1).check();
    await expect.poll(() => hybridText(page)).toBe("1 9 3 8 5"); // 全选 = target
    await waitRemaining(page, "0");

    // 先取消第二块不影响第一块的结果（一次性按原始坐标重放，无漂移）。
    await boxes.nth(1).uncheck();
    await expect.poll(() => hybridText(page)).toBe("1 9 3 4 5");
  });

  test("重复镜头：同名镜头按原始下标处理，不选错项", async ({ page }) => {
    await fillList(page, "source-editor", [1, 2, 2, 1]);
    await fillList(page, "target-editor", [1, 2, 1]);
    await compute(page);

    expect(await hybridText(page)).toBe("1 2 2 1");
    await page.getByTestId("block-checkbox").check();
    await expect.poll(() => hybridText(page)).toBe("1 2 1");
    await waitRemaining(page, "0");
  });

  test("全部采纳/全部不采纳按钮在任意块数下满足 source/target 端点", async ({
    page,
  }) => {
    await fillList(page, "source-editor", [1, 2, 3]);
    await fillList(page, "target-editor", [1, 4, 3]);
    await compute(page);

    await page.getByTestId("select-all").click();
    await expect.poll(() => hybridText(page)).toBe("1 4 3");
    await page.getByTestId("select-none").click();
    await expect.poll(() => hybridText(page)).toBe("1 2 3");
  });
});

test.describe("撤销与裁决", () => {
  test("修改原始输入撤销旧块选择与可下载混合序列", async ({ page }) => {
    await fillList(page, "source-editor", [1, 2, 3]);
    await fillList(page, "target-editor", [1, 4, 3]);
    await compute(page);
    await page.getByTestId("block-checkbox").check();
    await expect.poll(() => hybridText(page)).toBe("1 4 3");

    // 改动原始输入：旧选择与产物立即撤销，下载按钮禁用。
    await page.getByLabel("源序列第 0 项").fill("9");
    await expect(page.getByTestId("dirty-warning")).toBeVisible();
    await expect(page.getByTestId("hybrid-length")).toContainText("共 0 项");
    await expect(page.getByTestId("download-hybrid")).toBeDisabled();
    await expect(page.getByTestId("remaining-revoked")).toBeVisible();

    // 重新计算后恢复可用：默认不选，混合序列精确等于新 source。
    await page.getByTestId("compare").click();
    await expect(page.getByTestId("dirty-warning")).toHaveCount(0);
    await expect.poll(() => hybridText(page)).toBe("9 2 3");
  });

  test("原始差分失败撤销旧块选择（先成功后 422）", async ({ page }) => {
    await fillList(page, "source-editor", [1, 2, 3]);
    await fillList(page, "target-editor", [1, 4, 3]);
    await compute(page);
    await expect(page.getByTestId("block-review")).toBeVisible();

    // 改成非法输入导致原始差分失败：面板与原始轨迹都消失。
    await page.getByLabel("源序列第 0 项").fill("3.5");
    await page.getByTestId("compare").click();
    await expect(page.getByTestId("error-banner")).toContainText("INVALID_INPUT");
    await expect(page.getByTestId("block-review")).toHaveCount(0);
    await expect(page.getByTestId("result-view")).toHaveCount(0);
  });
});

test.describe("乱序的剩余轨迹响应", () => {
  test("迟到的旧响应不覆盖新选择", async ({ page }) => {
    // 放行规则：
    //  - 第一次 /diff（原始对齐）立即放行；
    //  - 第一次剩余轨迹（不选，混合 [1,2,3]）挂起；
    //  - 后续剩余轨迹（选中，混合 [1,4,3]）立即放行；
    //  - 测试末尾再放行挂起的旧请求。
    let blockedResolve: (() => void) | null = null;
    let call = 0;

    await page.route("**/api/diff", async (route) => {
      const req = route.request().postDataJSON() as {
        source: number[];
        target: number[];
      };
      call += 1;
      if (call === 1) {
        await route.continue();
        return;
      }
      if (call === 2) {
        await new Promise<void>((resolve) => {
          blockedResolve = resolve;
        });
        await route.continue();
        return;
      }
      await route.continue();
    });

    await fillList(page, "source-editor", [1, 2, 3]);
    await fillList(page, "target-editor", [1, 4, 3]);
    await compute(page);
    await expect(page.getByTestId("remaining-loading")).toBeVisible();

    // 选中块 -> 第二次剩余请求立即返回距离 0（旧请求仍挂起）。
    await page.getByTestId("block-checkbox").check();
    await expect(page.getByTestId("remaining-distance")).toContainText("0");

    // 让迟到的旧响应（混合 [1,2,3]，距离 2）此时才到达：必须被丢弃。
    blockedResolve!();
    await page.waitForTimeout(500);
    await expect(page.getByTestId("remaining-distance")).toContainText("0");
    expect(await hybridText(page)).toBe("1 4 3");
  });
});
