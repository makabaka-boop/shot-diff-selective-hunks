import { useState } from "react";
import { NumberListEditor } from "./components/NumberListEditor";
import { ResultView } from "./components/ResultView";
import { ErrorBanner } from "./components/ErrorBanner";
import { postDiff } from "./api";
import type { ApiError, DiffResult } from "./types";

export function App() {
  const [source, setSource] = useState<string[]>([""]);
  const [target, setTarget] = useState<string[]>([""]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [result, setResult] = useState<DiffResult | null>(null);

  const submit = async () => {
    setLoading(true);
    setError(null);
    try {
      setResult(await postDiff(source, target));
    } catch (e) {
      setError(e as ApiError);
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main>
      <h1>纪录片重剪 · 镜头序列变更轨迹</h1>
      <p className="muted">
        输入源序列与重剪后目标序列（0–2147483647 的整数，每组至多 20000 项）。
        后端以有界 Myers（只搜索至 d=800）求最短插入/删除对齐，相同编号沿对角线保留。
      </p>

      <div className="editors">
        <NumberListEditor title="源序列" testId="source-editor" rows={source} onChange={setSource} />
        <NumberListEditor title="目标序列" testId="target-editor" rows={target} onChange={setTarget} />
      </div>

      <div className="actions">
        <button type="button" data-testid="compare" onClick={submit} disabled={loading}>
          {loading ? "计算中…" : "计算变更轨迹"}
        </button>
      </div>

      {error && <ErrorBanner error={error} />}
      {result && <ResultView result={result} />}
    </main>
  );
}
