import { FlameNode, MethodEntry } from "./analyzer";

export interface ProfileNode {
  name: string;
  kind: FlameNode["kind"];
  lineNumber?: number;
  /** Cumulative time, including children */
  totalMs: number;
  /** Exclusive time — totalMs minus the sum of every direct child's totalMs */
  selfMs: number;
  /** Number of times this name appears in the flame tree */
  callCount: number;
  /** Whether this node lies on the hot path */
  onHotPath: boolean;
  children: ProfileNode[];
}

export interface MethodAggregate {
  name: string;
  lineNumber?: number;
  totalMs: number;
  selfMs: number;
  callCount: number;
  pctOfTotal: number;
}

export interface CpuProfile {
  root: ProfileNode;
  hotPath: ProfileNode[];
  hotLeaf?: ProfileNode;
  byTotal: MethodAggregate[];
  bySelf: MethodAggregate[];
  totalMs: number;
}

export function buildCpuProfile(flameRoot: FlameNode, methods: MethodEntry[]): CpuProfile {
  const root = toProfileNode(flameRoot);
  const totalMs = root.totalMs > 0 ? root.totalMs : Math.max(...methods.map(m => m.durationMs), 0);
  const { hotPath, hotLeaf } = computeHotPath(root);
  const aggregates = aggregateByName(root, totalMs);
  return {
    root,
    hotPath,
    hotLeaf,
    byTotal: [...aggregates].sort((a, b) => b.totalMs - a.totalMs).slice(0, 50),
    bySelf: [...aggregates].sort((a, b) => b.selfMs - a.selfMs).slice(0, 50),
    totalMs,
  };
}

function toProfileNode(n: FlameNode): ProfileNode {
  const children = n.children.map(toProfileNode);
  const childTotal = children.reduce((s, c) => s + c.totalMs, 0);
  const totalMs = n.durationMs;
  const selfMs = Math.max(0, totalMs - childTotal);
  return {
    name: n.name,
    kind: n.kind,
    lineNumber: n.lineNumber,
    totalMs,
    selfMs,
    callCount: 1,
    onHotPath: false,
    children,
  };
}

interface HotResult {
  hotPath: ProfileNode[];
  hotLeaf?: ProfileNode;
}

function computeHotPath(root: ProfileNode): HotResult {
  let best: ProfileNode | undefined;
  const stack: ProfileNode[] = [root];
  while (stack.length) {
    const n = stack.pop()!;
    if (n.kind !== "root") {
      if (!best || n.selfMs > best.selfMs) {
        best = n;
      }
    }
    for (const c of n.children) {
      stack.push(c);
    }
  }
  if (!best) {
    return { hotPath: [] };
  }
  const path: ProfileNode[] = [];
  if (findPath(root, best, path)) {
    for (const p of path) {
      p.onHotPath = true;
    }
    return {
      hotPath: path.filter(p => p.kind !== "root"),
      hotLeaf: best,
    };
  }
  return { hotPath: [] };
}

function findPath(node: ProfileNode, target: ProfileNode, out: ProfileNode[]): boolean {
  out.push(node);
  if (node === target) {
    return true;
  }
  for (const c of node.children) {
    if (findPath(c, target, out)) {
      return true;
    }
  }
  out.pop();
  return false;
}

function aggregateByName(root: ProfileNode, totalMs: number): MethodAggregate[] {
  const map = new Map<string, MethodAggregate>();
  const visit = (n: ProfileNode) => {
    if (n.kind !== "root") {
      const key = n.name;
      const e = map.get(key);
      if (e) {
        e.totalMs += n.totalMs;
        e.selfMs += n.selfMs;
        e.callCount += 1;
      } else {
        map.set(key, {
          name: n.name,
          lineNumber: n.lineNumber,
          totalMs: n.totalMs,
          selfMs: n.selfMs,
          callCount: 1,
          pctOfTotal: 0,
        });
      }
    }
    for (const c of n.children) {
      visit(c);
    }
  };
  visit(root);
  for (const v of map.values()) {
    v.pctOfTotal = totalMs > 0 ? (v.totalMs / totalMs) * 100 : 0;
  }
  return [...map.values()];
}
