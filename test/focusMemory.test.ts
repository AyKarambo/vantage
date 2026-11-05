import { describe, it, expect } from 'vitest';
import { pathFrom, resolvePath, type PathNode } from '../renderer/src/focusMemory';

/** A tiny stand-in for an element tree: `tree(tree(), tree(tree()))`. */
interface Fake extends PathNode {
  parentElement: Fake | null;
  children: Fake[];
}
function tree(...kids: Fake[]): Fake {
  const node: Fake = { parentElement: null, children: kids };
  for (const k of kids) k.parentElement = node;
  return node;
}

describe('focusMemory paths', () => {
  it('records the child-index path from the root to a nested node', () => {
    const target = tree();
    const root = tree(tree(), tree(tree(), target));
    expect(pathFrom(root, target)).toEqual([1, 1]);
  });

  it('resolves the same path in a rebuilt tree of the same shape', () => {
    const before = tree();
    const rootA = tree(tree(), tree(tree(), before));
    const after = tree();
    const rootB = tree(tree(), tree(tree(), after));
    const path = pathFrom(rootA, before)!;
    expect(resolvePath(rootB, path)).toBe(after);
  });

  it('returns null for a node outside the root, or the root itself', () => {
    const root = tree(tree());
    const stray = tree();
    tree(stray);
    expect(pathFrom(root, stray)).toBeNull();
    expect(pathFrom(root, root)).toBeNull();
  });

  it('returns null when the rebuilt tree no longer has that position', () => {
    const root = tree(tree());
    expect(resolvePath(root, [0, 3])).toBeNull();
    expect(resolvePath(root, [2])).toBeNull();
  });
});
