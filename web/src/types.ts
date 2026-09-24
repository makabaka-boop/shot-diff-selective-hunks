export type RowType = "keep" | "delete" | "insert";

export interface AlignmentRow {
  type: RowType;
  source: number | null;
  target: number | null;
  value: number;
}

export interface DiffResult {
  distance: number;
  length_source: number;
  length_target: number;
  alignment: AlignmentRow[];
}

/**
 * 不可拆分差异块：最短对齐中一段连续的非 keep 步骤。
 * 同一段内的删除/插入共享同一处边界（删除 [start,end) 个源项、
 * 插入 [targetStart,targetEnd) 个目标项），不适用的一侧为 null。
 * 编号与跨度全部由原始对齐顺序决定，选择任意子集都保持稳定。
 */
export interface DiffBlock {
  /** 块编号：按其在原始对齐中首次出现的顺序，从零起编。 */
  id: number;
  /** 该块覆盖的原始对齐行下标。 */
  rowIndexes: number[];
  sourceStart: number | null;
  sourceEnd: number | null;
  targetStart: number | null;
  targetEnd: number | null;
  deletes: AlignmentRow[];
  inserts: AlignmentRow[];
}

export type ErrorCode = "INVALID_INPUT" | "DIFF_LIMIT";

export interface Issue {
  loc: (string | number)[];
  type: string;
}

export interface ApiError {
  code: ErrorCode;
  message: string;
  issues?: Issue[];
}
