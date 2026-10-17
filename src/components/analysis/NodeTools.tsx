import { useEffect, useState } from 'react';
import { NAG_SYMBOLS, type TreeNode } from '../../analysis/tree';

const MOVE_NAGS = [1, 2, 3, 4, 5, 6];
const POSITION_NAGS = [18, 16, 14, 10, 13, 15, 17, 19];
const NAG_TITLES: Record<number, string> = {
  1: 'Good move',
  2: 'Mistake',
  3: 'Brilliant move',
  4: 'Blunder',
  5: 'Interesting move',
  6: 'Dubious move',
  10: 'Equal position',
  13: 'Unclear position',
  14: 'White is slightly better',
  15: 'Black is slightly better',
  16: 'White is better',
  17: 'Black is better',
  18: 'White is winning',
  19: 'Black is winning',
};

interface Props {
  node: TreeNode;
  isRoot: boolean;
  isMainline: boolean;
  onNag: (nag: number) => void;
  onComment: (text: string) => void;
  onDelete: () => void;
  onPromote: () => void;
  onMainline: () => void;
}

export function NodeTools({ node, isRoot, isMainline, onNag, onComment, onDelete, onPromote, onMainline }: Props) {
  const [draft, setDraft] = useState(node.comment);
  // a different node (or an external change) resets the draft
  useEffect(() => {
    setDraft(node.comment);
  }, [node]);

  const nagButtons = (nags: number[]) =>
    nags.map(n => (
      <button
        key={n}
        type="button"
        className={`nag${node.nags.includes(n) ? ' on' : ''}`}
        title={NAG_TITLES[n]}
        aria-label={NAG_TITLES[n]}
        aria-pressed={node.nags.includes(n)}
        disabled={isRoot}
        onClick={() => onNag(n)}
      >
        {NAG_SYMBOLS[n]}
      </button>
    ));

  return (
    <section className="panel node-tools" aria-label="Annotate move">
      <h2>{isRoot ? 'Start position' : `Annotate ${node.san}`}</h2>
      <div className="nag-row">{nagButtons(MOVE_NAGS)}</div>
      <div className="nag-row">{nagButtons(POSITION_NAGS)}</div>
      <label className="field">
        <span>Comment</span>
        <textarea
          rows={2}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={() => draft !== node.comment && onComment(draft)}
          placeholder="Add a comment… (saved when you leave the box)"
        />
      </label>
      <div className="row">
        <button type="button" onClick={onPromote} disabled={isRoot || isMainline} title="Move this variation up one level">
          ↑ Promote
        </button>
        <button type="button" onClick={onMainline} disabled={isRoot || isMainline} title="Make this line the main line">
          ⇈ Main line
        </button>
        <button type="button" className="danger-outline" onClick={onDelete} disabled={isRoot} title="Delete this move and the moves after it">
          ✕ Delete from here
        </button>
      </div>
    </section>
  );
}
