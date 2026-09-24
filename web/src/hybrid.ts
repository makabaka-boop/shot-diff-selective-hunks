import type { AlignmentRow, DiffBlock, DiffResult } from "./types";

/**
 * 把最短对齐中的连续非 keep 步骤归为不可拆分差异块。
 *
 * 规则：扫描原始对齐，遇到 keep（或首行即为非 keep）即断开一段；
 * 一段内的所有删除与插入属于同一块（它们共享同一处编辑边界，
 * 例如平局裁决产生的 insert 紧跟 delete 仍是一块）。
 *
 * 块编号、源跨度、目标跨度全部直接取自原始对齐行的零基下标，
 * 因此无论用户选择哪些块，这些值都不会漂移。
 */
export function groupBlocks(alignment: AlignmentRow[]): DiffBlock[] {
  const blocks: DiffBlock[] = [];
  let rowIndexes: number[] = [];

  const flush = () => {
    if (rowIndexes.length === 0) return;
    const deletes = rowIndexes
      .map((i) => alignment[i])
      .filter((r) => r.type === "delete");
    const inserts = rowIndexes
      .map((i) => alignment[i])
      .filter((r) => r.type === "insert");
    const sourceIdx = deletes.map((r) => r.source as number);
    const targetIdx = inserts.map((r) => r.target as number);
    blocks.push({
      id: blocks.length,
      rowIndexes: rowIndexes.slice(),
      deletes,
      inserts,
      sourceStart: sourceIdx.length ? Math.min(...sourceIdx) : null,
      sourceEnd: sourceIdx.length ? Math.max(...sourceIdx) + 1 : null,
      targetStart: targetIdx.length ? Math.min(...targetIdx) : null,
      targetEnd: targetIdx.length ? Math.max(...targetIdx) + 1 : null,
    });
    rowIndexes = [];
  };

  alignment.forEach((row, i) => {
    if (row.type === "keep") {
      flush();
    } else {
      rowIndexes.push(i);
    }
  });
  flush();
  return blocks;
}

/**
 * 以**原始 source 坐标一次性重放**构造混合序列。
 *
 * 遍历原始对齐恰好一次：keep 恒产出（其两侧坐标不变）；
 * 非 keep 行按“所属块是否被采纳”决定——
 * - 采纳的块：删除不产出、插入按目标下标取值插入；
 * - 未采纳的块：删除的源项保留产出、插入不产出。
 *
 * 因为只按原始对齐顺序扫一遍、直接用行内的原始下标取值，
 * 先应用哪一块都不会造成后续下标漂移：
 * - selected 为空 => 精确等于 source；
 * - selected 覆盖全部块 => 精确等于 target。
 */
export function buildHybrid(
  result: Pick<DiffResult, "alignment">,
  blocks: DiffBlock[],
  selected: ReadonlySet<number>,
  source: number[],
  target: number[]
): number[] {
  // 每条非 keep 行 -> 所属块编号（只有一个块），一次构建、反复使用。
  const blockOf = new Map<number, number>();
  for (const block of blocks) {
    for (const rowIndex of block.rowIndexes) {
      blockOf.set(rowIndex, block.id);
    }
  }

  const out: number[] = [];
  result.alignment.forEach((row, i) => {
    if (row.type === "keep") {
      // 保留恒发生，值取自原始 source 下标。
      out.push(source[row.source as number]);
      return;
    }
    const accepted = selected.has(blockOf.get(i) as number);
    if (row.type === "insert") {
      // 采纳：插入目标项；不采纳：跳过插入。
      if (accepted) out.push(target[row.target as number]);
    } else {
      // delete：不采纳时源项原样保留；采纳则不产出。
      if (!accepted) out.push(source[row.source as number]);
    }
  });
  return out;
}

/** 从原始对齐行中取出原始 source 序列（用于校验/导出）。 */
export function sourceOf(result: DiffResult): number[] {
  return result.alignment
    .filter((r) => r.type !== "insert")
    .map((r) => r.value);
}

/** 全选时的理论目标序列（采纳所有插入、跳过所有删除）。 */
export function targetOf(alignment: AlignmentRow[]): number[] {
  return alignment.filter((r) => r.type !== "delete").map((r) => r.value);
}

/**
 * 剩余轨迹请求闸：只有最后一次（令牌相同）的请求允许落盘。
 *
 * 选择快速变化时会连续请求 /diff；晚到的旧响应即使先 resolve，
 * 也因令牌不同而被拒绝，绝不覆盖新选择对应的剩余轨迹。
 */
export class RequestGate {
  private token = 0;

  /** 开启新一轮请求，返回本轮令牌。 */
  next(): number {
    this.token += 1;
    return this.token;
  }

  /** 该令牌是否仍是最新一轮。 */
  isCurrent(token: number): boolean {
    return token === this.token;
  }
}
