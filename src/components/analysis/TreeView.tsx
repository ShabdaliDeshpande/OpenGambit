import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { isWhiteMove, moveNumber, NAG_SYMBOLS, type TreeNode } from '../../analysis/tree';

interface Props {
  root: TreeNode;
  path: string[];
  onSelect: (path: string[]) => void;
}

const samePath = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * The move tree as text: main line in bold, variations in parentheses,
 * top-level variations on their own indented line. Comments are shown inline.
 */
export function TreeView({ root, path, onSelect }: Props) {
  const activeRef = useRef<HTMLButtonElement>(null);
  // block body on purpose: newer browsers return a Promise from scrollIntoView,
  // and an effect must not return anything but a cleanup function
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [path]);

  const move = (node: TreeNode, nodePath: string[], forceNumber: boolean, main: boolean) => {
    const active = samePath(nodePath, path);
    const number = isWhiteMove(node) ? `${moveNumber(node)}.` : forceNumber ? `${moveNumber(node)}...` : '';
    return [
      <button
        key={nodePath.join(' ')}
        type="button"
        ref={active ? activeRef : undefined}
        className={`tree-move${main ? ' main' : ''}${active ? ' active' : ''}`}
        onClick={() => onSelect(nodePath)}
      >
        {number && <span className="tree-num">{number}</span>}
        {node.san}
        {node.nags.length > 0 && <span className="tree-nag">{node.nags.map(n => NAG_SYMBOLS[n] ?? `$${n}`).join('')}</span>}
      </button>,
      node.comment.trim() ? (
        <span key={`${nodePath.join(' ')}-c`} className="tree-comment">
          {node.comment}
        </span>
      ) : null,
    ];
  };

  /** Everything after `parent`; `depth` 0 is the main line. */
  const line = (parent: TreeNode, parentPath: string[], forceNumber: boolean, depth: number): ReactNode[] => {
    const out: ReactNode[] = [];
    let node = parent;
    let nodePath = parentPath;
    let force = forceNumber;
    while (node.children.length > 0) {
      const [main, ...alternatives] = node.children as [TreeNode, ...TreeNode[]];
      const mainPath = [...nodePath, main.id];
      out.push(...move(main, mainPath, force, depth === 0));
      force = main.comment.trim() !== '';
      for (const alt of alternatives) {
        const altPath = [...nodePath, alt.id];
        const content = [...move(alt, altPath, true, false), ...line(alt, altPath, alt.comment.trim() !== '', depth + 1)];
        out.push(
          depth === 0 ? (
            <div key={`v-${altPath.join(' ')}`} className="tree-variation block">
              {content}
            </div>
          ) : (
            <span key={`v-${altPath.join(' ')}`} className="tree-variation">
              ({content})
            </span>
          ),
        );
        force = true;
      }
      node = main;
      nodePath = mainPath;
    }
    return out;
  };

  return (
    <div className="tree" aria-label="Moves">
      {root.comment.trim() && <span className="tree-comment">{root.comment}</span>}
      {root.children.length === 0 ? <p className="muted">Make a move on the board, or load a PGN.</p> : line(root, [], true, 0)}
    </div>
  );
}
