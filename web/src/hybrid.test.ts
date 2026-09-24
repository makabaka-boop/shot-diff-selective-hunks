import { describe, expect, it } from "vitest";
import {
  RequestGate,
  buildHybrid,
  groupBlocks,
} from "./hybrid";
import type { AlignmentRow, DiffResult } from "./types";

type Row = ["keep" | "insert" | "delete", number | null, number | null, number?];

/** 以 (类型, source, target[, value]) 元组构造对齐行。 */
function rows(tuples: Row[]): AlignmentRow[] {
  return tuples.map(([type, source, target]) => {
    const value =
      type === "insert"
        ? 100 + (target as number)
        : 10 + (source as number);
    return { type, source, target, value };
  });
}

function result(tuples: Row[]): DiffResult {
  const alignment = rows(tuples);
  return {
    distance: alignment.filter((r) => r.type !== "keep").length,
    length_source: alignment.filter((r) => r.type !== "insert").length,
    length_target: alignment.filter((r) => r.type !== "delete").length,
    alignment,
  };
}

/** 从对齐行取源序列（非 insert 的取值）。 */
function srcOf(tuples: Row[]): number[] {
  return rows(tuples)
    .filter((r) => r.type !== "insert")
    .map((r) => r.value);
}
/** 从对齐行取目标序列（非 delete 的取值）。 */
function tgtOf(tuples: Row[]): number[] {
  return rows(tuples)
    .filter((r) => r.type !== "delete")
    .map((r) => r.value);
}

function hybridOf(tuples: Row[], selected: number[]): number[] {
  const res = result(tuples);
  const blocks = groupBlocks(res.alignment);
  return buildHybrid(
    res,
    blocks,
    new Set(selected),
    srcOf(tuples),
    tgtOf(tuples)
  );
}

describe("groupBlocks 连续非 keep 步骤归块", () => {
  it("纯插入：全部插入归为同一块，源跨度为 null、目标跨度覆盖插入段", () => {
    // source [10,13], target [10,11,12,13]：中间连续插入两处。
    const t: Row[] = [
      ["keep", 0, 0],
      ["insert", null, 1],
      ["insert", null, 2],
      ["keep", 1, 3],
    ];
    const blocks = groupBlocks(rows(t));
    expect(blocks).toHaveLength(1);
    expect(blocks[0].id).toBe(0);
    expect(blocks[0].rowIndexes).toEqual([1, 2]);
    expect(blocks[0].sourceStart).toBeNull();
    expect(blocks[0].sourceEnd).toBeNull();
    expect(blocks[0].targetStart).toBe(1);
    expect(blocks[0].targetEnd).toBe(3);
  });

  it("纯删除：连续删除归为同一块，目标跨度为 null", () => {
    const t: Row[] = [
      ["keep", 0, 0],
      ["delete", 1, null],
      ["delete", 2, null],
      ["keep", 3, 1],
    ];
    const blocks = groupBlocks(rows(t));
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      id: 0,
      sourceStart: 1,
      sourceEnd: 3,
      targetStart: null,
      targetEnd: null,
    });
  });

  it("删除与同一边界的插入属于同一块（平局：insert 紧跟 delete）", () => {
    // [1,2,3] -> [1,4,3]：keep, insert, delete, keep
    const t: Row[] = [
      ["keep", 0, 0],
      ["insert", null, 1],
      ["delete", 1, null],
      ["keep", 2, 2],
    ];
    const blocks = groupBlocks(rows(t));
    expect(blocks).toHaveLength(1);
    expect(blocks[0].rowIndexes).toEqual([1, 2]);
    expect(blocks[0].sourceStart).toBe(1);
    expect(blocks[0].sourceEnd).toBe(2);
    expect(blocks[0].targetStart).toBe(1);
    expect(blocks[0].targetEnd).toBe(2);
  });

  it("相邻改写：两处改写之间只要有 keep 即拆成编号稳定的两块", () => {
    const t: Row[] = [
      ["keep", 0, 0],
      ["delete", 1, null],
      ["insert", null, 1],
      ["keep", 2, 2],
      ["insert", null, 3],
      ["delete", 3, null],
      ["keep", 4, 4],
    ];
    const blocks = groupBlocks(rows(t));
    expect(blocks.map((b) => b.id)).toEqual([0, 1]);
    expect(blocks[0].rowIndexes).toEqual([1, 2]);
    expect(blocks[1].rowIndexes).toEqual([4, 5]);
    // 块编号与跨度由原始对齐决定，与选择无关（这里只断言稳定结构）。
    expect(blocks[1]).toMatchObject({
      sourceStart: 3,
      sourceEnd: 4,
      targetStart: 3,
      targetEnd: 4,
    });
  });

  it("纯保留轨迹没有差异块", () => {
    const t: Row[] = [
      ["keep", 0, 0],
      ["keep", 1, 1],
    ];
    expect(groupBlocks(rows(t))).toEqual([]);
  });
});

describe("buildHybrid 以原始 source 坐标一次性重放", () => {
  it("纯插入：不选等于 source，全选等于 target，单块采纳插入", () => {
    const t: Row[] = [
      ["keep", 0, 0],
      ["insert", null, 1],
      ["insert", null, 2],
      ["keep", 1, 3],
    ];
    const s = srcOf(t);
    const g = tgtOf(t);
    expect(hybridOf(t, [])).toEqual(s);
    expect(hybridOf(t, [0])).toEqual(g);
    expect(s).toEqual([10, 11]);
    expect(g).toEqual([10, 101, 102, 11]);
  });

  it("纯删除：不选保留全部源项，采纳后等于 target", () => {
    const t: Row[] = [
      ["keep", 0, 0],
      ["delete", 1, null],
      ["delete", 2, null],
      ["keep", 3, 1],
    ];
    expect(hybridOf(t, [])).toEqual([10, 11, 12, 13]);
    expect(hybridOf(t, [0])).toEqual([10, 13]);
    expect(hybridOf(t, [0])).toEqual(tgtOf(t));
  });

  it("相邻改写：逐块独立采纳且无下标漂移，任意子集结果稳定", () => {
    const t: Row[] = [
      ["keep", 0, 0],
      ["delete", 1, null],
      ["insert", null, 1],
      ["keep", 2, 2],
      ["insert", null, 3],
      ["delete", 3, null],
      ["keep", 4, 4],
    ];
    const s = srcOf(t);
    const g = tgtOf(t);
    // 块 0：源项 11 -> 目标项 101；块 1：源项 13 -> 目标项 103。
    expect(hybridOf(t, [])).toEqual(s); // 都不采纳 = source
    expect(hybridOf(t, [0, 1])).toEqual(g); // 全采纳 = target
    expect(hybridOf(t, [0])).toEqual([10, 101, 12, 13, 14]);
    expect(hybridOf(t, [1])).toEqual([10, 11, 12, 103, 14]);
    // 反序采纳结果与顺序无关：一次性重放，不漂移。
    expect(hybridOf(t, [1, 0])).toEqual(g);
  });

  it("同一边界的删除+插入：不采纳保留被删项且不插入，全采纳二者同时生效", () => {
    const t: Row[] = [
      ["keep", 0, 0],
      ["insert", null, 1],
      ["delete", 1, null],
      ["keep", 2, 2],
    ];
    expect(hybridOf(t, [])).toEqual([10, 11, 12]);
    expect(hybridOf(t, [0])).toEqual([10, 101, 12]);
    expect(hybridOf(t, [0])).toEqual(tgtOf(t));
  });

  it("重复镜头：取值按原始下标取得，重复编号互不干扰", () => {
    // source [1,2,2,1] -> target [1,2,1]：删除下标 2 的重复 2。
    // 手工给出与该变换一致的对齐（值由 helper 按坐标生成，这里改用真实值）。
    const alignment: AlignmentRow[] = [
      { type: "keep", source: 0, target: 0, value: 1 },
      { type: "keep", source: 1, target: 1, value: 2 },
      { type: "delete", source: 2, target: null, value: 2 },
      { type: "keep", source: 3, target: 2, value: 1 },
    ];
    const res: DiffResult = {
      distance: 1,
      length_source: 4,
      length_target: 3,
      alignment,
    };
    const blocks = groupBlocks(alignment);
    expect(blocks).toHaveLength(1);
    const source = [1, 2, 2, 1];
    const target = [1, 2, 1];
    expect(buildHybrid(res, blocks, new Set(), source, target)).toEqual(source);
    expect(buildHybrid(res, blocks, new Set([0]), source, target)).toEqual(
      target
    );
  });

  it("块编号/跨度在不同选择下保持稳定（多次分组结果一致）", () => {
    const t: Row[] = [
      ["delete", 0, null],
      ["insert", null, 0],
      ["keep", 1, 1],
      ["delete", 2, null],
    ];
    const res = result(t);
    const first = groupBlocks(res.alignment);
    const second = groupBlocks(res.alignment);
    expect(first).toEqual(second);
    expect(first.map((b) => [b.id, b.sourceStart, b.targetStart])).toEqual([
      [0, 0, 0],
      [1, 2, null],
    ]);
  });
});

describe("RequestGate 乱序响应裁决", () => {
  it("只有最新一轮令牌有效，晚到的旧响应被拒绝", () => {
    const gate = new RequestGate();
    const t1 = gate.next();
    const t2 = gate.next();
    expect(gate.isCurrent(t1)).toBe(false); // t1 的响应晚到 -> 必须丢弃
    expect(gate.isCurrent(t2)).toBe(true); // 最新选择的响应可落盘
    const t3 = gate.next();
    expect(gate.isCurrent(t2)).toBe(false);
    expect(gate.isCurrent(t3)).toBe(true);
  });
});
