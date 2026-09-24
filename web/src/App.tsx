import { useEffect, useMemo, useRef, useState } from "react";
import { NumberListEditor } from "./components/NumberListEditor";
import { ResultView } from "./components/ResultView";
import { BlockReview } from "./components/BlockReview";
import { ErrorBanner } from "./components/ErrorBanner";
import { postDiff, postRemainingDiff } from "./api";
import {
  RequestGate,
  buildHybrid,
  groupBlocks,
  sourceOf,
  targetOf,
} from "./hybrid";
import type { ApiError, DiffResult } from "./types";

export function App() {
  const [source, setSource] = useState<string[]>([""]);
  const [target, setTarget] = useState<string[]>([""]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [result, setResult] = useState<DiffResult | null>(null);

  // 逐块选择；块编号/跨度只依赖原始对齐，选择本身不会改写任何下标。
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  // 原始输入在最近一次成功计算之后是否被改动过（改动即撤销旧选择与产物）。
  const [dirty, setDirty] = useState(false);

  // 混合序列 -> target 的剩余轨迹（用现有 /diff 计算，绝不覆盖原始对齐）。
  const [remaining, setRemaining] = useState<DiffResult | null>(null);
  const [remainingLoading, setRemainingLoading] = useState(false);
  const [remainingError, setRemainingError] = useState<string | null>(null);
  // 迟到响应闸：只有最新一次选择对应的响应允许落盘。
  const remainingGate = useRef(new RequestGate());

  const blocks = useMemo(
    () => (result ? groupBlocks(result.alignment) : []),
    [result]
  );
  const submittedSource = useMemo(
    () => (result ? sourceOf(result) : []),
    [result]
  );
  const submittedTarget = useMemo(
    () => (result ? targetOf(result.alignment) : []),
    [result]
  );

  // 始终以原始 source 坐标一次性重放，选择任意子集都不产生下标漂移。
  // 输入一旦被改动（dirty），旧块选择与可下载混合序列即被撤销（清空产物）。
  const hybrid = useMemo(() => {
    if (!result || dirty) return [];
    return buildHybrid(
      result,
      blocks,
      selected,
      submittedSource,
      submittedTarget
    );
  }, [result, dirty, blocks, selected, submittedSource, submittedTarget]);

  // 选择变化后用现有 /diff 计算剩余轨迹；令牌过期的晚到响应一律丢弃。
  useEffect(() => {
    if (!result || dirty) {
      setRemaining(null);
      setRemainingError(null);
      setRemainingLoading(false);
      return;
    }
    const token = remainingGate.current.next();
    setRemainingLoading(true);
    setRemainingError(null);
    let cancelled = false;
    void postRemainingDiff(hybrid, submittedTarget)
      .then((res) => {
        if (cancelled || !remainingGate.current.isCurrent(token)) return;
        setRemaining(res);
        setRemainingError(null);
      })
      .catch((e: ApiError) => {
        if (cancelled || !remainingGate.current.isCurrent(token)) return;
        setRemaining(null);
        setRemainingError(e?.message ?? "剩余轨迹计算失败");
      })
      .finally(() => {
        if (!cancelled && remainingGate.current.isCurrent(token)) {
          setRemainingLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [result, dirty, hybrid, submittedTarget]);

  /** 修改任一原始输入：立即撤销旧块选择与可下载混合序列。 */
  const handleInputChange =
    (setter: (rows: string[]) => void) => (rows: string[]) => {
      setter(rows);
      if (result) {
        setDirty(true);
        setSelected(new Set());
        setRemaining(null);
        setRemainingError(null);
      }
    };

  const submit = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await postDiff(source, target);
      // 成功：重新分块、清空旧选择；原始对齐是唯一权威，不被剩余轨迹覆盖。
      setResult(res);
      setSelected(new Set());
      setRemaining(null);
      setRemainingError(null);
      setDirty(false);
    } catch (e) {
      // 原始差分失败：撤销旧块选择、混合序列与剩余轨迹。
      setError(e as ApiError);
      setResult(null);
      setSelected(new Set());
      setRemaining(null);
      setRemainingError(null);
      setDirty(false);
    } finally {
      setLoading(false);
    }
  };

  const toggleBlock = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const setAll = (value: boolean) => {
    setSelected(value ? new Set(blocks.map((b) => b.id)) : new Set());
  };

  return (
    <main>
      <h1>纪录片重剪 · 镜头序列变更轨迹</h1>
      <p className="muted">
        输入源序列与重剪后目标序列（0–2147483647 的整数，每组至多 20000 项）。
        后端以有界 Myers（只搜索至 d=800）求最短插入/删除对齐，相同编号沿对角线保留。
      </p>

      <div className="editors">
        <NumberListEditor
          title="源序列"
          testId="source-editor"
          rows={source}
          onChange={handleInputChange(setSource)}
        />
        <NumberListEditor
          title="目标序列"
          testId="target-editor"
          rows={target}
          onChange={handleInputChange(setTarget)}
        />
      </div>

      <div className="actions">
        <button type="button" data-testid="compare" onClick={submit} disabled={loading}>
          {loading ? "计算中…" : "计算变更轨迹"}
        </button>
      </div>

      {error && <ErrorBanner error={error} />}
      {result && <ResultView result={result} />}
      {result && (
        <BlockReview
          blocks={blocks}
          selected={dirty ? new Set() : selected}
          onToggle={toggleBlock}
          onSetAll={setAll}
          hybrid={hybrid}
          remaining={remaining}
          remainingLoading={remainingLoading}
          remainingError={remainingError}
          dirty={dirty}
        />
      )}
    </main>
  );
}
