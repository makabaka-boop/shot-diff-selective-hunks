import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App } from "./App";

interface Row {
  type: "keep" | "insert" | "delete";
  source: number | null;
  target: number | null;
  value: number;
}

// [1,2,3] -> [1,4,3]：keep, insert, delete, keep（单块，平局 insert+delete 同边界）。
const alignment: Row[] = [
  { type: "keep", source: 0, target: 0, value: 1 },
  { type: "insert", source: null, target: 1, value: 4 },
  { type: "delete", source: 1, target: null, value: 2 },
  { type: "keep", source: 2, target: 2, value: 3 },
];
const originalDiff = {
  distance: 2,
  length_source: 3,
  length_target: 3,
  alignment,
};

function ok(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as Response;
}
function err(code: string, message: string): Response {
  return {
    ok: false,
    status: 422,
    json: async () => ({ detail: { code, message } }),
  } as Response;
}

/** 读取请求体，区分原始差分与剩余轨迹请求。 */
function bodyOf(input: RequestInfo | URL, init?: RequestInit): unknown {
  return JSON.parse(String((init as RequestInit)?.body ?? "{}"));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("逐块采纳与混合序列", () => {
  it("不选时混合序列等于 source，全选等于 target，剩余距离随之变化", async () => {
    const calls: { source: unknown }[] = [];
    // 插入/删除距离（与后端同口径）：|a|+|b|-2*LCS。
    const distanceOf = (a: number[], b: number[]): number => {
      let prev = new Array(b.length + 1).fill(0);
      for (const x of a) {
        const cur = new Array(b.length + 1).fill(0);
        b.forEach((y, j) => {
          cur[j + 1] = x === y ? prev[j] + 1 : Math.max(prev[j + 1], cur[j]);
        });
        prev = cur;
      }
      return a.length + b.length - 2 * prev[b.length];
    };
    const fetchMock = vi.fn(async (input, init) => {
      const body = bodyOf(input, init) as { source: number[]; target: number[] };
      calls.push(body);
      if (calls.length === 1) return ok(originalDiff);
      // 剩余轨迹：source 为当前混合序列，距离按真实 LCS 口径给出。
      const distance = distanceOf(body.source, body.target);
      return ok({
        distance,
        length_source: body.source.length,
        length_target: body.target.length,
        alignment:
          distance === 0
            ? body.target.map((v: number, i: number) => ({
                type: "keep",
                source: i,
                target: i,
                value: v,
              }))
            : [
                { type: "keep", source: 0, target: 0, value: 1 },
                { type: "insert", source: null, target: 1, value: 4 },
                { type: "delete", source: 1, target: null, value: 2 },
                { type: "keep", source: 2, target: 2, value: 3 },
              ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    fireEvent.click(screen.getByTestId("compare"));
    await screen.findByTestId("block-review");

    // 初始不选：混合序列精确等于 source。
    expect(screen.getByTestId("hybrid-sequence")).toHaveTextContent("1 2 3");
    await waitFor(() =>
      expect(screen.getByTestId("remaining-distance")).toHaveTextContent("2")
    );

    // 采纳唯一一块：删除 2、插入 4，混合序列精确等于 target。
    fireEvent.click(screen.getByTestId("block-checkbox"));
    await waitFor(() =>
      expect(screen.getByTestId("hybrid-sequence")).toHaveTextContent("1 4 3")
    );
    await waitFor(() =>
      expect(screen.getByTestId("remaining-distance")).toHaveTextContent("0")
    );

    // 剩余轨迹请求的 source 就是混合序列，且原始对齐始终保留（距离仍为 2）。
    const remainingCalls = calls.slice(1).map((c) => c.source);
    expect(remainingCalls).toContainEqual([1, 2, 3]);
    expect(remainingCalls).toContainEqual([1, 4, 3]);
    expect(screen.getByTestId("distance")).toHaveTextContent("2");
  });

  it("修改任一原始输入即撤销旧块选择与可下载混合序列", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ok(originalDiff)));
    render(<App />);
    fireEvent.click(screen.getByTestId("compare"));
    await screen.findByTestId("block-review");

    fireEvent.click(screen.getByTestId("block-checkbox"));
    await waitFor(() =>
      expect(screen.getByTestId("hybrid-sequence")).toHaveTextContent("1 4 3")
    );

    // 修改源输入：选择与可下载混合序列被撤销，面板提示重新计算。
    fireEvent.change(screen.getByLabelText("源序列第 0 项"), {
      target: { value: "9" },
    });
    expect(screen.getByTestId("dirty-warning")).toBeInTheDocument();
    // 可交付混合序列已被撤销：产物清空、长度归零，下载按钮禁用。
    expect(screen.getByTestId("hybrid-sequence")).toHaveTextContent("");
    expect(screen.getByTestId("hybrid-length")).toHaveTextContent("共 0 项");
    expect(screen.getByTestId("remaining-revoked")).toBeInTheDocument();
    expect(
      screen.getByTestId("download-hybrid") as HTMLButtonElement
    ).toBeDisabled();
    expect(
      (screen.getByTestId("block-checkbox") as HTMLInputElement).checked
    ).toBe(false);
  });

  it("原始差分失败时撤销旧块选择和混合序列（先成功后失败）", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(ok(originalDiff))
        .mockResolvedValueOnce(ok(originalDiff)) // 首次加载的剩余轨迹请求
        .mockResolvedValueOnce(
          err("DIFF_LIMIT", "编辑距离超过 800 的搜索上限")
        )
    );
    render(<App />);
    fireEvent.click(screen.getByTestId("compare"));
    await screen.findByTestId("block-review");

    // 再次提交但差分失败：整个分块/混合面板消失，只剩错误。
    fireEvent.click(screen.getByTestId("compare"));
    await waitFor(() =>
      expect(screen.getByTestId("error-banner")).toBeInTheDocument()
    );
    expect(screen.queryByTestId("block-review")).not.toBeInTheDocument();
    expect(screen.queryByTestId("result-view")).not.toBeInTheDocument();
    expect(screen.getByTestId("error-banner")).toHaveTextContent("DIFF_LIMIT");
  });

  it("迟到的剩余轨迹响应不覆盖新选择（乱序响应）", async () => {
    // 手动控制两次剩余轨迹请求的返回时机。
    let firstResolve: ((r: Response) => void) | null = null;
    let callCount = 0;
    const fetchMock = vi.fn(async (_input, init) => {
      const body = bodyOf(_input, init) as { source: number[] };
      callCount += 1;
      if (callCount === 1) return ok(originalDiff);
      if (callCount === 2) {
        // 第一次（不选 -> 混合 [1,2,3]）的响应被故意挂起。
        return await new Promise<Response>((resolve) => {
          firstResolve = resolve;
        });
      }
      // 第二次（选中 -> 混合 [1,4,3]，与 target 相同）立即返回距离 0。
      return ok({
        distance: 0,
        length_source: 3,
        length_target: 3,
        alignment: [1, 4, 3].map((v, i) => ({
          type: "keep",
          source: i,
          target: i,
          value: v,
        })),
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    fireEvent.click(screen.getByTestId("compare"));
    await screen.findByTestId("block-review");
    await waitFor(() => expect(firstResolve).not.toBeNull());

    // 选择发生变化：第二次请求先行返回距离 0。
    fireEvent.click(screen.getByTestId("block-checkbox"));
    await waitFor(() =>
      expect(screen.getByTestId("remaining-distance")).toHaveTextContent("0")
    );

    // 旧请求（对应未选择状态，距离 2）此刻才迟到，必须被丢弃。
    firstResolve!(
      ok({
        distance: 2,
        length_source: 3,
        length_target: 3,
        alignment,
      })
    );
    // 等待足够时间确认没有被旧响应覆盖。
    await waitFor(() =>
      expect(screen.getByTestId("remaining-distance")).toHaveTextContent("0")
    );
    expect(screen.getByTestId("remaining-distance")).toHaveTextContent("0");
  });
});
