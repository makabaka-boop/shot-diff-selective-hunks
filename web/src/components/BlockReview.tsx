import type { DiffBlock, DiffResult } from "../types";

interface Props {
  blocks: DiffBlock[];
  selected: ReadonlySet<number>;
  onToggle: (id: number) => void;
  onSetAll: (value: boolean) => void;
  hybrid: number[];
  remaining: DiffResult | null;
  remainingLoading: boolean;
  remainingError: string | null;
  dirty: boolean;
}

function span(start: number | null, end: number | null): string {
  if (start === null || end === null) return "—";
  return `[${start}, ${end})`;
}

function describeBlock(block: DiffBlock): string {
  const parts: string[] = [];
  if (block.deletes.length) {
    parts.push(`删除源 ${block.deletes.map((r) => r.value).join("、")}`);
  }
  if (block.inserts.length) {
    parts.push(`插入 ${block.inserts.map((r) => r.value).join("、")}`);
  }
  return parts.join("；");
}

function downloadHybrid(hybrid: number[]) {
  const blob = new Blob([`${JSON.stringify(hybrid)}\n`], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  // 可下载的混合镜头序列（以原始 source 坐标一次性重放的产物）。
  a.download = "mixed-shots.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function BlockReview({
  blocks,
  selected,
  onToggle,
  onSetAll,
  hybrid,
  remaining,
  remainingLoading,
  remainingError,
  dirty,
}: Props) {
  return (
    <section className="review" data-testid="block-review">
      <h2>逐块采纳差异</h2>

      {dirty && (
        <p className="warn" role="alert" data-testid="dirty-warning">
          原始输入已被修改：旧的块选择与可下载混合序列已撤销，请重新计算变更轨迹。
        </p>
      )}

      {blocks.length === 0 ? (
        <p className="muted" data-testid="no-blocks">
          源序列与目标序列完全一致，没有需要采纳的差异块。
        </p>
      ) : (
        <>
          <div className="review-actions">
            <button
              type="button"
              data-testid="select-all"
              onClick={() => onSetAll(true)}
              disabled={dirty}
            >
              全部采纳
            </button>
            <button
              type="button"
              data-testid="select-none"
              onClick={() => onSetAll(false)}
              disabled={dirty}
            >
              全部不采纳
            </button>
          </div>

          <ul className="blocks">
            {blocks.map((block) => (
              <li key={block.id} className="block" data-testid="block-item">
                <label>
                  <input
                    type="checkbox"
                    data-testid="block-checkbox"
                    data-block-id={block.id}
                    checked={selected.has(block.id)}
                    disabled={dirty}
                    onChange={() => onToggle(block.id)}
                  />
                  <span data-testid="block-label">
                    块 {block.id}：{describeBlock(block)}（源跨度
                    {span(block.sourceStart, block.sourceEnd)}，目标跨度
                    {span(block.targetStart, block.targetEnd)}）
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="hybrid" data-testid="hybrid-panel">
        <h3>可交付混合镜头序列</h3>
        <p className="muted" data-testid="hybrid-length">
          共 {hybrid.length} 项；不选任何块时等于源序列，全选时等于目标序列。
        </p>
        <p className="sequence" data-testid="hybrid-sequence">
          {hybrid.join(" ")}
        </p>
        <button
          type="button"
          data-testid="download-hybrid"
          onClick={() => downloadHybrid(hybrid)}
          disabled={dirty}
        >
          下载混合序列 JSON
        </button>
      </div>

      <div className="remaining" data-testid="remaining-panel">
        <h3>到目标序列的剩余轨迹</h3>
        {dirty ? (
          <p className="muted" data-testid="remaining-revoked">
            输入已变更，剩余轨迹已撤销。
          </p>
        ) : remainingLoading ? (
          <p className="muted" data-testid="remaining-loading">
            剩余轨迹计算中…
          </p>
        ) : remainingError ? (
          <p className="warn" role="alert" data-testid="remaining-error">
            {remainingError}
          </p>
        ) : remaining ? (
          <>
            <p className="muted" data-testid="remaining-distance">
              尚未采纳的编辑步数：<strong>{remaining.distance}</strong>
            </p>
            <ul className="remaining-rows">
              {remaining.alignment.map((row, i) => (
                <li key={i} data-testid="remaining-row" className={`op op-${row.type}`}>
                  {row.type === "keep"
                    ? `保留 ${row.value}`
                    : row.type === "insert"
                      ? `插入 ${row.value}`
                      : `删除 ${row.value}`}
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </div>
    </section>
  );
}
